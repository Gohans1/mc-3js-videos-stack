"""CPU SDK execution; imports stay lazy so validation/help never load optional models."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


CLOCK_COMPENSATION = "async=1:min_comp=0:min_hard_comp=0.002"


def audio_decode_command(source, wav, start, end, rate, mono, origin, pcm_codec, layout=None):
    trim = f"atrim=start_sample={round(start * rate)}"
    if end is not None:
        trim += f":end_sample={round(end * rate)}"
    # Resample on the file clock before trimming so even a slice keeps decoder and resampler preroll.
    filters = ",".join([
        f"asetpts=PTS-round({origin:.9f}/TB)",
        f"aresample={rate}:{CLOCK_COMPENSATION}:first_pts=0",
        trim,
        "asetpts=PTS-STARTPTS",
    ])
    command = ["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-copyts", "-reinit_filter", "0"]
    if layout:
        command += ["-ch_layout", layout]
    command += ["-i", str(source), "-vn", "-af", filters]
    if mono:
        command += ["-ac", "1"]
    return [*command, "-c:a", pcm_codec, str(wav)]


def normalized_channel_layout(source):
    # Filter n resets on reinit, so ashowinfo reports only the first frame of each layout.
    probe = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-v", "info", "-xerror", "-nostdin", "-copyts",
         "-i", str(source), "-vn", "-af", r"aselect=eq(n\,0),ashowinfo", "-c:a", "pcm_f32le", "-f", "null", "-"],
        capture_output=True, timeout=120,
    )
    output = probe.stderr.decode("utf-8", errors="replace")
    if probe.returncode:
        print(output, file=sys.stderr, end="")
        probe.check_returncode()
    layouts = re.findall(
        r"^\[Parsed_ashowinfo_\d+ @ [^\]]+\] n:\d+ [^\r\n]*? channels:(\d+) chlayout:(.*?) rate:",
        output, flags=re.M,
    )
    if not layouts:
        raise ValueError("Could not verify source channel layouts before normalizing audio")
    wider = {layout for channels, layout in layouts if int(channels) > 1}
    if len(wider) <= 1:
        return next(iter(wider), None)

    available = subprocess.run(["ffmpeg", "-layouts"], check=True, capture_output=True, text=True, timeout=10)
    native_channels, _, standard_layouts = available.stdout.partition("Standard channel layouts:")
    speakers = dict(re.findall(r"^(\S+)\s+([A-Z0-9]+(?:\+[A-Z0-9]+)+)\s*$", standard_layouts, flags=re.M))
    if set(speakers) >= wider:
        required = {channel for layout in wider for channel in speakers[layout].split("+")}
        for layout, channels in speakers.items():
            if set(channels.split("+")) == required:
                return layout
        order = [line.split()[0] for line in native_channels.splitlines() if line.split()]
        ordered = [channel for channel in order if channel in required]
        if set(ordered) == required:
            return "+".join(ordered)
    raise ValueError("Cannot preserve channel layouts " + ", ".join(sorted(wider))
                     + " in one WAV. Normalize the channel layout explicitly first.")


def decode_audio(source, wav, start, end, rate, mono, record_command, *, pcm_codec="pcm_s16le"):
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=start_time,format_name",
                           "-of", "json", str(source)], check=True, capture_output=True, text=True, timeout=30)
    container = json.loads(info.stdout)["format"]
    start_time = container.get("start_time")
    origin = float(start_time) if start_time not in (None, "N/A") else 0.0

    command = audio_decode_command(source, wav, start, end, rate, mono, origin, pcm_codec)
    record_command("decodeCommand", command)
    decoded = subprocess.run(command, stderr=subprocess.PIPE, timeout=120)
    if decoded.returncode == 0:
        return

    error = decoded.stderr.decode("utf-8", errors="replace")
    if "Changing audio frame properties on the fly is not supported" not in error:
        print(error, file=sys.stderr, end="")
        decoded.check_returncode()

    # Keep trim state on a fixed-format stream when the source changes audio properties.
    prepare = ["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-copyts", "-i", str(source), "-vn"]
    resample = f"aresample={rate}"
    if mono:
        resample += ":ochl=mono:rematrix_maxval=1"
    if container.get("format_name") in ("aac", "mp3"):
        # Raw ADTS and MP3 clocks are synthesized and can drift when the rate changes.
        normalized = wav.with_name(wav.stem + "-normalized.wav")
        prepare += ["-af", resample]
    else:
        normalized = wav.with_suffix(".nut")
        filters = f"asetpts=PTS-round({origin:.9f}/TB),{resample}:{CLOCK_COMPENSATION}"
        # Keep packets past the trim end so their PTS can anchor a gap.
        prepare += ["-af", filters]
    layout = None if mono else normalized_channel_layout(source)
    if mono:
        prepare += ["-ac", "1"]
    elif layout:
        prepare += ["-ch_layout", layout]
    prepare += ["-c:a", "pcm_f32le", str(normalized)]
    record_command("decodePreparationCommand", prepare)
    subprocess.run(prepare, check=True, timeout=120)
    # NUT carries sample count and timestamps but may omit the PCM speaker mask.
    command = audio_decode_command(normalized, wav, start, end, rate, mono, 0, pcm_codec, layout)
    record_command("decodeCommand", command)
    wav.unlink(missing_ok=True)
    subprocess.run(command, check=True, timeout=120)


def audio_coverage(wav, start, end):
    import soundfile as sf

    info = sf.info(wav)
    rate = info.samplerate
    first = round(start * rate)
    requested = None if end is None else round(end * rate) - first
    status = "complete"
    if not info.frames:
        status = "empty"
    elif requested is not None and info.frames < requested:
        status = "partial"
    return {
        "status": status,
        "requested": {"fromSeconds": start, "toSeconds": end},
        "analyzed": {"fromSeconds": first / rate, "toSeconds": (first + info.frames) / rate} if info.frames else None,
        "sampleRate": rate,
        "sampleCount": info.frames,
    }


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


def wav_layout(wav):
    details = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channel_layout",
         "-of", "default=nw=1:nk=1", str(wav)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return details.stdout.strip()


def pack_effect_input(wav):
    import soundfile as sf

    if wav_layout(wav) not in ("", "unknown", "mono", "stereo"):
        return
    # FFmpeg writes compact float WAV without a mono/stereo mask.
    with TemporaryDirectory(dir=wav.parent) as scratch:
        tagged = Path(scratch) / "input.wav"
        with sf.SoundFile(wav) as source:
            if source.channels not in (1, 2):
                return
            with sf.SoundFile(tagged, mode="w", samplerate=source.samplerate,
                              channels=source.channels, subtype="FLOAT", format="WAVEX") as dest:
                for block in source.blocks(blocksize=65536, dtype="float32", always_2d=True):
                    dest.write(block)
        tagged.replace(wav)


def audio_replay_command(command, *, wavex=False):
    action = "decode-effects" if wavex else "decode-pcm"
    return [sys.executable, "-B", str(Path(__file__).resolve()), action, *command[1:]]


def replay_audio(args, *, wavex):
    output = Path(args[-1])
    if output.exists() or output.is_symlink():
        raise FileExistsError(f"Audio replay output already exists: {output}")
    with TemporaryDirectory(prefix="audio-replay-", dir=output.parent) as scratch:
        staged = Path(scratch) / output.name
        subprocess.run(["ffmpeg", *args[:-1], str(staged)], check=True, timeout=120)
        if wavex:
            pack_effect_input(staged)
        if os.name == "nt":
            staged.rename(output)
        else:
            output.hardlink_to(staged)


def write_effect(output, samples, rate, layout):
    import soundfile as sf

    if layout in ("mono", "stereo"):
        sf.write(output, samples, rate, subtype="PCM_24", format="WAVEX")
        return
    if layout in ("", "unknown"):
        sf.write(output, samples, rate, subtype="PCM_24")
        return

    with TemporaryDirectory(dir=output.parent) as scratch:
        rendered = Path(scratch) / "processed.wav"
        sf.write(rendered, samples, rate, subtype="PCM_24")
        subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-ch_layout", layout,
                        "-i", str(rendered), "-c:a", "copy", str(output)], check=True, timeout=120)


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

        layout = wav_layout(wav)
        board = []
        for plugin in config:
            cls = getattr(pedalboard, plugin["name"], None)
            if not isinstance(cls, type) or not issubclass(cls, pedalboard.Plugin):
                raise ValueError(f"unknown Pedalboard plugin: {plugin['name']}")
            board.append(cls(**plugin.get("parameters", {})))
        board = pedalboard.Pedalboard(board)
        frames = len(audio) + round(args.tail * rate)
        # Pedalboard infers channels from the smaller axis, including when the buffer is very short.
        working_frames = max(frames, audio.shape[1] + 1)
        padded = np.pad(audio.T, ((0, 0), (0, working_frames - len(audio))))
        processed = board(padded, rate, reset=True)[:, :frames]
        write_effect(out / "effect.wav", processed.T, rate, layout)
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


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    if len(sys.argv) < 3 or sys.argv[1] not in ("decode-effects", "decode-pcm"):
        raise SystemExit("Use the decode command saved by the media SDK.")
    try:
        replay_audio(sys.argv[2:], wavex=sys.argv[1] == "decode-effects")
    except (OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
