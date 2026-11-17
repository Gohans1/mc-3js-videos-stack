"""OTIO handoff uses frame ranges and preserves references/metadata, without rendering scene code."""
import json
import math


def validate_timeline(data):
    def object_with_metadata(value, label):
        if not isinstance(value, dict):
            raise ValueError(f"{label} must be an object")
        if "metadata" in value and not isinstance(value["metadata"], dict):
            raise ValueError(f"{label} metadata must be an object")
        if "name" in value and not isinstance(value["name"], str):
            raise ValueError(f"{label} name must be a string")

    def number(value, label, minimum):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
            raise ValueError(f"{label} must be a finite number >= {minimum}")

    object_with_metadata(data, "timeline")
    number(data.get("fps"), "fps", 0.000001)
    if not isinstance(data.get("tracks"), list):
        raise ValueError("tracks must be an array")
    for track in data["tracks"]:
        object_with_metadata(track, "track")
        if track.get("kind", "Video") not in ("Video", "Audio"):
            raise ValueError("track kind must be Video or Audio")
        if not isinstance(track.get("clips"), list):
            raise ValueError("clips must be an array")
        for clip in track["clips"]:
            object_with_metadata(clip, "clip")
            if "gap" in clip and not isinstance(clip["gap"], bool):
                raise ValueError("gap must be a boolean")
            number(clip.get("duration"), "duration", 0.000001)
            number(clip.get("start", 0), "start", 0)
            if not clip.get("gap") and not isinstance(clip.get("url"), str):
                raise ValueError("each clip requires url, or gap:true")
    return data


def process_timeline(source, out):
    import opentimelineio as otio
    if source.suffix.lower() == ".otio":
        timeline = otio.adapters.read_from_file(str(source))
    else:
        data = validate_timeline(json.loads(source.read_text(encoding="utf-8")))
        timeline = otio.schema.Timeline(name=data.get("name", "Media handoff"), metadata=data.get("metadata", {}))
        rt, tr = otio.opentime.RationalTime, otio.opentime.TimeRange
        for item in data["tracks"]:
            track = otio.schema.Track(name=item.get("name", ""), kind=item.get("kind", "Video"), metadata=item.get("metadata", {}))
            timeline.tracks.append(track)
            for row in item["clips"]:
                span = tr(rt(row.get("start", 0), data["fps"]), rt(row["duration"], data["fps"]))
                if row.get("gap"):
                    track.append(otio.schema.Gap(name=row.get("name", ""), source_range=span, metadata=row.get("metadata", {})))
                else:
                    track.append(otio.schema.Clip(name=row.get("name", ""), source_range=span, metadata=row.get("metadata", {}),
                                                  media_reference=otio.schema.ExternalReference(target_url=row["url"])))
    path = out / "timeline.otio"
    otio.adapters.write_to_file(timeline, str(path))
    loaded = otio.adapters.read_from_file(str(path))
    if otio.adapters.write_to_string(timeline, "otio_json") != otio.adapters.write_to_string(loaded, "otio_json"):
        raise ValueError("OTIO roundtrip changed data")
    return {"timeline": path.name, "durationSeconds": loaded.duration().to_seconds(), "roundtripVerified": True,
            "scope": "references, ranges and metadata; renderer effects/speed curves require their own baked media or NLE adapter"}
