"""Writes the drawer dig's read-and-throw cycles (1:24.5-1:31.5) into src/timeline/steve.json and props.json: for each
folder, the hand reaches in, lifts it, he reads it, throws it aside. The first is read properly; each next one is
skimmed faster, as he learns they are all junk (the dev's note: read, see it is the same as the last, throw; faster each
time, never mechanical). Throws take a person's time (film-kit reach.ts timing works on the keys between), and the eyes
go to the next folder before the hand does (film-kit handeye.ts). Re-run after changing a number here, from the film
folder: python lab/dig_keys.py && python ../../scripts/timeline_fmt.py"""
import json
from pathlib import Path

T0, T1 = 84.5, 91.5  # first reach starts, last folder leaves the hand (the frenzy's keys start at 91.56)
AT = [1.88, 0, 9.55]
READ = [0.95, 0.6, 0.35, 0.2, 0.12, 0.08]  # s spent reading each folder
REACH = [0.4, 0.38, 0.34, 0.3, 0.28, 0.26]  # s, hand from his side into the drawer
LIFT = [0.3, 0.28, 0.25, 0.22, 0.2, 0.18]  # s, folder from the drawer up to read
THROW = [0.34, 0.32, 0.3, 0.28, 0.26, 0.24]  # s, from reading to letting go out at his side
HOLD, OVERLAP = 0.05, 0.12  # grip; the other hand starts reaching this long before this one lets go
FACES = [("curious", "unimpressed"), ("curious", "unimpressed"), ("unimpressed", "unimpressed"), ("restless", "restless"),
         ("seething", "seething"), ("seething", "seething")]
READ_AT = {"R": [1.48, 0.88, 9.45], "L": [1.48, 0.88, 9.65]}  # held low before his chest, eyes ~1.35 m: his face shows over it
LOOK_AT = {"R": [1.48, 1.0, 9.45], "L": [1.48, 1.0, 9.65]}  # the folder's face, above the hand that holds it
TOSS_AT = {"R": [1.85, 0.95, 9.1], "L": [1.85, 0.95, 10.0]}  # out at his side, where it leaves the hand

steps = [REACH[i] + HOLD + LIFT[i] + READ[i] + THROW[i] - (OVERLAP if i < 5 else 0) for i in range(6)]
k = (T1 - T0) / sum(steps)  # stretched or squeezed evenly to fill the span
cycles, t = [], T0
for i in range(6):
    hand = "R" if i % 2 == 0 else "L"
    s = t
    g = s + REACH[i] * k
    u = g + (HOLD + LIFT[i]) * k
    e = u + READ[i] * k
    r = e + THROW[i] * k
    cycles.append(dict(i=i, hand=hand, s=s, g=g, u=u, e=e, r=r))
    t = r - OVERLAP * k
r3 = lambda x: round(x, 3)

st = Path("src/timeline/steve.json")
d = json.loads(st.read_text(encoding="utf-8"))
d["moves"] = [m for m in d["moves"] if not (T0 <= m["t"] < 91.56)]
d["hands"] = [h for h in d["hands"] if not (T0 <= h["t"] < 91.56)]
d["look"] = [h for h in d["look"] if not (T0 <= h["t"] < 91.56)]
d["face"] = [h for h in d["face"] if not (84.9 <= h["t"] < 91.56)]
d["read"] = [r for r in d["read"] if not (T0 <= r[0] < 91.56)]
moves, hands, look, face, read = [], [], [], [], []
for c in cycles:
    i, h = c["i"], c["hand"]
    toss = "tossR" if h == "R" else "tossL"
    moves += [
        {"t": r3(c["g"]), "at": AT, "yaw": -90, "pose": "digReach", "do": f"bends in for folder {i}"},
        {"t": r3(c["u"]), "at": AT, "yaw": -90, "pose": "digRead", "do": "up on his knee to read it" if i < 3 else "up with it, a glance"},
        {"t": r3(c["e"]), "at": AT, "yaw": -90, "pose": "digRead", "do": "junk again" if i else "the same junk as the pages"},
        {"t": r3(c["r"]), "at": AT, "yaw": -90, "pose": toss, "do": "throws it aside"},
    ]
    hands += [
        {"t": r3(c["s"]), h: None},
        {"t": r3(c["g"]), h: f"folder_{i}"},
        {"t": r3(c["g"] + HOLD * k), h: f"folder_{i}"},
        {"t": r3(c["u"]), h: READ_AT[h]},
        {"t": r3(c["e"]), h: READ_AT[h]},
        {"t": r3(c["r"]), h: TOSS_AT[h]},
        {"t": r3(c["r"] + 0.3), h: None},
    ]
    # eyes on the folder half a second before the hand moves, then on what he reads, then on to the next folder
    look += [{"t": r3(max(T0 - 0.05, c["s"] - 0.3)), "at": f"folder_{i}"}, {"t": r3(c["u"] - 0.06), "at": LOOK_AT[h]}, {"t": r3(c["e"]), "at": LOOK_AT[h]}]
    if i < 5:
        look.append({"t": r3(c["e"] + 0.08), "at": f"folder_{i + 1}"})
    a, b = FACES[i]
    face += [{"t": r3(c["u"]), "mood": a}, {"t": r3(c["u"] + 0.6 * READ[i] * k), "mood": b}]
    read.append([r3(c["u"]), r3(c["e"])])
key = lambda x: x["t"]
d["moves"] = sorted(d["moves"] + moves, key=key)
d["hands"] = sorted(d["hands"] + hands, key=key)
d["look"] = sorted(d["look"] + look, key=key)
d["face"] = sorted(d["face"] + face, key=key)
d["read"] = sorted(d["read"] + read)
st.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")

pr = Path("src/timeline/props.json")
P = json.loads(pr.read_text(encoding="utf-8"))
for c in cycles:
    f = next(f for f in P["files"] if f["folder"] == c["i"])
    f.update(grab=r3(c["g"]), face=r3(c["u"] - 0.1), release=r3(c["r"]))
pr.write_text(json.dumps(P, ensure_ascii=False, indent=1), encoding="utf-8")
for c in cycles:
    print(f"folder {c['i']} {c['hand']}: reach {c['s']:.2f}, grab {c['g']:.2f}, read {c['u']:.2f}-{c['e']:.2f}, let go {c['r']:.2f}")
print(f"stretch {k:.3f}")
