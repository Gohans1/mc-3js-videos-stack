"""CPU SDK execution; imports stay lazy so validation/help never load optional models."""
import json


def note_rows(notes, start):
    return [{"start": start + float(n[0]), "end": start + float(n[1]),
             "midiPitch": int(n[2]), "amplitude": float(n[3]),
             "pitchBends": [int(value) for value in n[4]] if n[4] is not None else None} for n in notes]


def event_spans(values, start, step, threshold, duration):
    spans, first = [], None
    for index, value in enumerate([*values, float("-inf")]):
        if index * step < duration and value >= threshold:
            if first is None:
                first = index
        elif first is not None:
            spans.append({"start": start + first * step, "end": start + min(index * step, duration)})
            first = None
    return spans


def process_audio(args, config, model, wav, out):
    import soundfile as sf
    audio, rate = sf.read(wav, dtype="float32", always_2d=True)
    duration = len(audio) / rate
    if not len(audio):
        raise ValueError("selected range contains no audio samples")
    kind, result = args.tool, {"durationSeconds": duration, "verification": "model outputs are unverified hypotheses"}
    if kind in ("beat", "locate", "separate"):
        import torch
        torch.set_num_threads(args.threads)
    if kind == "beat":
        from beat_this.inference import Audio2Beats
        tracker = Audio2Beats(checkpoint_path=str(model), device="cpu", float16=False, **config)
        beats, downbeats = tracker(audio[:, 0], rate)
        result.update(beats=[args.start + float(t) for t in beats], downbeats=[args.start + float(t) for t in downbeats])
    elif kind == "vad":
        import sherpa_onnx as sherpa
        settings = sherpa.VadModelConfig()
        settings.silero_vad.model = str(model)
        settings.sample_rate, settings.num_threads = rate, args.threads
        for key, value in config.items():
            if key == "model":
                raise ValueError("use --model to select VAD weights")
            setattr(settings.silero_vad, key, value)
        detector = sherpa.VoiceActivityDetector(settings, buffer_size_in_seconds=30)
        segments = []

        def drain():
            while not detector.empty():
                segment = detector.front
                segments.append({"start": args.start + segment.start / rate,
                                 "end": args.start + min((segment.start + len(segment.samples)) / rate, duration)})
                detector.pop()
                (out / "speech.json").write_text(json.dumps(segments))

        for offset in range(0, len(audio), settings.silero_vad.window_size):
            detector.accept_waveform(audio[offset:offset + settings.silero_vad.window_size, 0])
            drain()
        detector.flush()
        drain()
        result["speech"] = segments
    elif kind == "melody":
        import numpy as np
        from basic_pitch.inference import predict
        outputs, midi, notes = predict(wav, **({"model_or_model_path": model} if model else {}), **config)
        midi.write(str(out / "melody.mid"))
        np.savez_compressed(out / "model-output.npz", **outputs)
        result["notes"] = note_rows(notes, args.start)
    elif kind == "effects":
        import numpy as np
        import pedalboard
        board = []
        for plugin in config:
            cls = getattr(pedalboard, plugin["name"], None)
            if not isinstance(cls, type) or not issubclass(cls, pedalboard.Plugin):
                raise ValueError(f"unknown Pedalboard plugin: {plugin['name']}")
            board.append(cls(**plugin.get("parameters", {})))
        board = pedalboard.Pedalboard(board)
        padded = np.pad(audio.T, ((0, 0), (0, round(args.tail * rate))))
        processed = board(padded, rate, reset=True)
        sf.write(out / "effect.wav", processed.T, rate, subtype="PCM_24")
        result.update(audio="effect.wav", tailSeconds=args.tail, verification="effect rendering; inspect audio for intent and artifacts")
    elif kind == "separate":
        from audio_separator.separator import Separator
        separator = Separator(model_file_dir=str(model.parent), output_dir=str(out), sample_rate=rate, **config)
        separator.load_model(model.name)
        result["stems"] = separator.separate(str(wav))
        if not result["stems"]:
            raise ValueError("separator returned no stems; the requested stem may be unavailable for this model")
    elif kind == "locate":
        import numpy as np
        from transformers import AutoProcessor, PeAudioFrameLevelModel
        processor = AutoProcessor.from_pretrained(model, local_files_only=True)
        network = PeAudioFrameLevelModel.from_pretrained(model, local_files_only=True, dtype=torch.float32).eval()
        inputs = {**processor.feature_extractor(audio[:, 0], sampling_rate=rate, return_tensors="pt"),
                  **processor.tokenizer(args.query, padding=True, return_tensors="pt")}
        with torch.inference_mode():
            logits = network(**inputs).logits_audio_text[0].float().cpu().numpy()
        np.savez_compressed(out / "raw-logits.npz", logits=logits)
        result.update(frameStepSeconds=0.04, scoreKind="raw similarity logits, not calibrated probability",
                      queries=[{"query": query, "rawLogits": values.tolist(),
                                "spans": event_spans(values.tolist(), args.start, 0.04, args.threshold, duration)}
                               for query, values in zip(args.query, logits)])
    return result
