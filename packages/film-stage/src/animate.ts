// @ts-nocheck
// Shot animations, CapCut's In / Out / Combo for a 3D camera, extended with the full Cinetic camera & optical vocabulary.
// A shot row's `anim` {in?, out?, combo?}, each {fx, len?, k?, curve?, flip?, optics?}, moves the camera the keys give (or
// darkens/grades the frame) without touching the keys, so None takes it off again and its length stays a number to change. In
// plays over the shot's first `len` seconds and lands on the keyed camera, Out leaves it over the last `len`, Combo runs the
// whole shot; all three can be on one shot. curve warps how far through it is over time, flip mirrors the move across the
// camera's right axis, optics scales only the lens state it writes (0 keeps the picture sharp); absent keeps the tuned effect.
// Returns how black the frame should be (0..1) and writes optical post-processing state onto `c.optics`.
import * as THREE from "three";

import { EASES } from "./camera";

export type BezierTuple = readonly [number, number, number, number];
export type AnimCurve =
  | "linear"
  | "smooth"
  | "snap"
  | "bounce"
  | "glide"
  | "whip"
  | "launch"
  | BezierTuple
  | (string & {});
export type AnimFx = {
  fx: string;
  len?: number;
  k?: number;
  curve?: AnimCurve;
  flip?: boolean;
  optics?: number;
  seam?: boolean;
};
export type ShotAnim = { in?: AnimFx; out?: AnimFx; combo?: AnimFx };

export const ANIM_CATEGORIES = ["Move", "Zoom", "Turn", "Lens & Light", "Shake"] as const;

// The studio's curve picker: auto (the effect's own tuned curve) plus time warps that keep the effect's shape and landing
export const ANIM_CURVES = [
  {
    id: "linear",
    title: "Linear",
    tip: "Constant speed, no acceleration: mechanical and unemotional",
  },
  { id: "smooth", title: "Smooth", tip: "Eases in and out: the calm, neutral choice" },
  {
    id: "snap",
    title: "Snap",
    tip: "Fast arrival on In, or holds then snaps hard into the cut on Out",
  },
  {
    id: "glide",
    title: "Glide",
    tip: "Cinetic velvet glide arrival on In, or smooth build into the cut on Out",
  },
  { id: "whip", title: "Whip", tip: "Cinetic asymmetric long build into a steep whip snap" },
  {
    id: "launch",
    title: "Carry / Launch",
    tip: "Two-stage exponential carry on In, stretched launch right at the cut on Out",
  },
  {
    id: "bounce",
    title: "Bounce",
    tip: "Settles with a bounce on In, or winds up into the cut on Out",
  },
] as const;
export type CameraOptics = {
  blur: number;
  exposure: number;
  fringe: number;
  bulge: number;
  sweep: number;
  sweepPos: number;
  smearX: number;
  smearY: number;
};

const EMPTY_OPTICS: CameraOptics = {
  blur: 0,
  exposure: 0,
  fringe: 0,
  bulge: 0,
  sweep: 0,
  sweepPos: 0.5,
  smearX: 0,
  smearY: 0,
};

// What the studio shows: id (stored as fx), title, cat (the tab's category chips), tip, len (seconds, the In/Out default),
// plus `pair` for cross-cut seam animations that automatically link Out on shot i with In on shot i + 1, `flip` for moves that
// change side or roll when mirrored, and `optics` for those that write the lens state (blur, exposure, fringe, bulge, sweep).
const IN = [
  {
    id: "push",
    title: "Push in",
    cat: "Move",
    move: "push",
    a: 1,
    len: 1,
    tip: "The camera glides forward into the frame",
  },
  {
    id: "pull",
    title: "Pull back",
    cat: "Move",
    move: "push",
    a: -1,
    len: 1,
    tip: "The camera glides back into the frame",
  },
  {
    id: "carryLaunch",
    pair: "carryLaunch",
    title: "Carry in",
    cat: "Move",
    move: "push",
    a: 1.25,
    len: 0.65,
    tip: "Two-stage exponential carry (60% fast drop + 40% slow tail) from the cut (pairs with Launch out)",
  },
  {
    id: "rise",
    title: "Rise",
    cat: "Move",
    move: "rise",
    a: 1,
    len: 1,
    tip: "Comes up into the frame from below",
  },
  {
    id: "lower",
    title: "Lower",
    cat: "Move",
    move: "rise",
    a: -1,
    len: 1,
    tip: "Comes down into the frame from above",
  },
  {
    id: "craneUp",
    title: "Crane arc up",
    cat: "Move",
    move: "rise",
    a: 1.25,
    len: 0.9,
    tip: "Vertical crane pedestal up while pitching to keep the subject framed",
  },
  {
    id: "craneDown",
    title: "Crane arc down",
    cat: "Move",
    move: "rise",
    a: -1.25,
    len: 0.9,
    tip: "Descend from above while tilting to settle onto the subject",
  },
  {
    id: "cranePush",
    title: "Crane push",
    cat: "Move",
    move: "push",
    a: 1.3,
    len: 0.95,
    tip: "Crane arc combined with a delayed dolly push into the subject",
  },
  {
    id: "slideL",
    title: "Slide left",
    cat: "Move",
    move: "slide",
    a: -1,
    len: 1,
    flip: true,
    tip: "Travels left into the frame",
  },
  {
    id: "slideR",
    title: "Slide right",
    cat: "Move",
    move: "slide",
    a: 1,
    len: 1,
    flip: true,
    tip: "Travels right into the frame",
  },
  {
    id: "orbitL",
    title: "Orbit left",
    cat: "Move",
    move: "orbit",
    a: -1,
    len: 1.2,
    flip: true,
    tip: "Arcs left around the subject into the frame",
  },
  {
    id: "orbitR",
    title: "Orbit right",
    cat: "Move",
    move: "orbit",
    a: 1,
    len: 1.2,
    flip: true,
    tip: "Arcs right around the subject into the frame",
  },
  {
    id: "isoToFlat",
    title: "Iso to flat",
    cat: "Move",
    move: "tilt",
    a: -1.3,
    len: 0.95,
    tip: "Descend from a high isometric pitch down to eye-level",
  },
  {
    id: "swing3D",
    title: "Swing 3D",
    cat: "Move",
    move: "orbit",
    a: 1.3,
    len: 0.95,
    flip: true,
    tip: "3D yaw/pitch swing + push landing at 80%, followed by a 6% slow drift tail",
  },
  {
    id: "zoomIn",
    title: "Zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1,
    len: 0.8,
    tip: "The lens tightens into the frame",
  },
  {
    id: "zoomOut",
    title: "Zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1,
    len: 0.8,
    tip: "The lens widens into the frame",
  },
  {
    id: "logZoomIn",
    title: "Log zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1.2,
    len: 0.7,
    tip: "True logarithmic FOV zoom where equal ratios move at equal perceived speed",
  },
  {
    id: "logZoomOut",
    title: "Log zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1.2,
    len: 0.7,
    tip: "True logarithmic FOV widen into the keyed frame",
  },
  {
    id: "snapZoomIn",
    title: "Snap zoom in",
    cat: "Zoom",
    move: "push",
    a: 1.4,
    len: 0.65,
    optics: true,
    tip: "28% slow log-scale build, steep snap jump with micro-defocus, 12% glide tail",
  },
  {
    id: "snapZoomOut",
    title: "Snap zoom out",
    cat: "Zoom",
    move: "push",
    a: -1.4,
    len: 0.65,
    optics: true,
    tip: "Open tight, snap-pull out on the beat with micro-defocus, and glide into the frame",
  },
  {
    id: "oversizeLand",
    title: "Oversize land",
    cat: "Zoom",
    move: "push",
    a: 1.35,
    len: 0.65,
    optics: true,
    tip: "Arrive oversized in log scale while soft focus clears cleanly onto the keyed frame",
  },
  {
    id: "zoomThrough",
    pair: "zoomThrough",
    title: "Zoom through",
    cat: "Zoom",
    move: "push",
    a: 1.6,
    len: 0.55,
    tip: "Carried exponential zoom settling from wide into the frame (pairs with previous shot's Out)",
  },
  {
    id: "zoomOutExit",
    pair: "zoomOutExit",
    title: "Zoom out settle",
    cat: "Zoom",
    move: "push",
    a: -1.3,
    len: 0.65,
    tip: "4-beat exponential brake and drift tail from a pull-out cut (pairs with previous shot's Out)",
  },
  {
    id: "insidePullout",
    title: "Inside pullout",
    cat: "Zoom",
    move: "push",
    a: -1.5,
    len: 0.9,
    tip: "Start tight inside the subject and pull out in log scale to the keyed frame",
  },
  {
    id: "scaleBreath",
    pair: "scaleBreath",
    title: "Scale breath",
    cat: "Zoom",
    move: "zoom",
    a: 0.45,
    len: 0.5,
    tip: "Subtle 8% scale/dolly settle carrying momentum across the cut (pairs with previous shot's Out)",
  },
  {
    id: "scaleBreathFlip",
    pair: "scaleBreathFlip",
    title: "Scale breath flip",
    cat: "Zoom",
    move: "zoom",
    a: -0.45,
    len: 0.5,
    tip: "Symmetric breathing seam: opens 8% tighter after an inward push and exhales into the frame",
  },
  {
    id: "punchOut",
    pair: "punchOut",
    title: "Punch out",
    cat: "Zoom",
    move: "push",
    a: -1.25,
    len: 0.55,
    flip: true,
    tip: "Wide landing carrying outward momentum and decaying after the cut (pairs with previous shot's Out)",
  },
  {
    id: "panL",
    title: "Pan left",
    cat: "Turn",
    move: "pan",
    a: -1,
    len: 1,
    flip: true,
    tip: "Turns left onto the frame",
  },
  {
    id: "panR",
    title: "Pan right",
    cat: "Turn",
    move: "pan",
    a: 1,
    len: 1,
    flip: true,
    tip: "Turns right onto the frame",
  },
  {
    id: "tiltU",
    title: "Tilt up",
    cat: "Turn",
    move: "tilt",
    a: 1,
    len: 1,
    tip: "Tips up onto the frame",
  },
  {
    id: "tiltD",
    title: "Tilt down",
    cat: "Turn",
    move: "tilt",
    a: -1,
    len: 1,
    tip: "Tips down onto the frame",
  },
  {
    id: "whipL",
    title: "Whip left",
    cat: "Turn",
    move: "whip",
    a: -1,
    len: 0.35,
    flip: true,
    tip: "A fast turn left that snaps onto the frame",
  },
  {
    id: "whipR",
    title: "Whip right",
    cat: "Turn",
    move: "whip",
    a: 1,
    len: 0.35,
    flip: true,
    tip: "A fast turn right that snaps onto the frame",
  },
  {
    id: "whipDipL",
    pair: "whipDipL",
    title: "Whip dip left",
    cat: "Turn",
    move: "whip",
    a: -1.15,
    len: 0.45,
    flip: true,
    optics: true,
    tip: "Whip pan from right with mid-whip FOV widen dip, roll accent, and directional shutter smear",
  },
  {
    id: "whipDipR",
    pair: "whipDipR",
    title: "Whip dip right",
    cat: "Turn",
    move: "whip",
    a: 1.15,
    len: 0.45,
    flip: true,
    optics: true,
    tip: "Whip pan from left with mid-whip FOV widen dip, roll accent, and directional shutter smear",
  },
  {
    id: "level",
    title: "Level out",
    cat: "Turn",
    move: "roll",
    a: 1,
    len: 1,
    flip: true,
    tip: "Starts tipped over and levels out",
  },
  {
    id: "rollAccent",
    title: "Roll accent",
    cat: "Turn",
    move: "roll",
    a: 0.85,
    len: 0.75,
    flip: true,
    tip: "Push in with a temporary Dutch roll accent that levels back out",
  },
  {
    id: "barrelRoll",
    title: "Barrel roll",
    cat: "Turn",
    move: "roll",
    a: 2.2,
    len: 0.85,
    flip: true,
    tip: "180° barrel roll along the lens axis while pushing into the frame",
  },
  {
    id: "spinUp",
    pair: "spinUp",
    title: "Rotation decay",
    cat: "Turn",
    move: "orbit",
    a: 1.4,
    len: 0.7,
    flip: true,
    tip: "Geometric decay from fast spin to a slow cruise across the cut (pairs with Spin up)",
  },
  {
    id: "fade",
    title: "Fade in",
    cat: "Lens & Light",
    black: true,
    len: 1,
    tip: "Opens from black",
  },
  {
    id: "blackDip",
    pair: "blackDip",
    title: "Black dip whip",
    cat: "Lens & Light",
    black: true,
    move: "whip",
    len: 0.4,
    flip: true,
    tip: "Fast fade-up from black while settling from a whip cut",
  },
  {
    id: "flashCut",
    pair: "flashCut",
    title: "Flash whip",
    cat: "Lens & Light",
    move: "whip",
    a: -1.1,
    len: 0.45,
    flip: true,
    optics: true,
    tip: "High-speed smeared whip entry + pull-back settle emerging from a white flash",
  },
  {
    id: "exposureBloom",
    pair: "exposureBloom",
    title: "Exposure bloom",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.35,
    len: 0.55,
    optics: true,
    tip: "Settle from an overexposed bloom peak into the keyed grade",
  },
  {
    id: "lightSweep",
    title: "Light sweep",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.5,
    len: 0.75,
    flip: true,
    optics: true,
    tip: "Diagonal specular light band sweeping across the lens on arrival",
  },
  {
    id: "blurThrough",
    pair: "blurThrough",
    title: "Rack focus in",
    cat: "Lens & Light",
    move: "zoom",
    a: -0.4,
    len: 0.55,
    optics: true,
    tip: "Pull focus from defocus blur while settling scale into the frame (pairs with Blur through)",
  },
  {
    id: "blurBridge",
    pair: "blurBridge",
    title: "Blur bridge",
    cat: "Lens & Light",
    move: "zoom",
    a: -0.6,
    len: 0.25,
    optics: true,
    tip: "Snap focus clear from a 9% pull-back bridge across the cut (pairs with Blur bridge)",
  },
  {
    id: "occluderDive",
    pair: "occluderDive",
    title: "Dive emerge",
    cat: "Lens & Light",
    black: true,
    move: "push",
    len: 0.65,
    optics: true,
    tip: "Rise into frame from an occluder dive while focus lags motion by 4 frames",
  },
  {
    id: "macroDive",
    pair: "macroDive",
    title: "Macro dive in",
    cat: "Lens & Light",
    move: "push",
    a: 1.5,
    len: 0.65,
    flip: true,
    optics: true,
    tip: "Emerge from a deep 3D logarithmic macro dive with clearing defocus and vertical smear",
  },
  {
    id: "rush",
    pair: "rush",
    title: "Rush in",
    cat: "Lens & Light",
    move: "push",
    a: 1.45,
    len: 0.55,
    optics: true,
    tip: "Halving-speed rush settle with decaying RGB chromatic aberration (pairs with Rush out)",
  },
  {
    id: "lensBulge",
    pair: "lensBulge",
    title: "Lens bulge",
    cat: "Lens & Light",
    move: "push",
    a: 1.2,
    len: 0.65,
    optics: true,
    tip: "Fast push-in with speed-coupled barrel lens distortion that flattens at rest",
  },
  {
    id: "impact",
    title: "Impact",
    cat: "Shake",
    jolt: true,
    len: 0.5,
    flip: true,
    tip: "Opens on a jolt that dies away",
  },
  {
    id: "impactKick",
    title: "Impact kick",
    cat: "Shake",
    jolt: true,
    len: 0.45,
    flip: true,
    tip: "Directional velocity kick with 1.5% FOV punch that decays exponentially",
  },
];

const OUT = [
  {
    id: "push",
    title: "Push in",
    cat: "Move",
    move: "push",
    a: 1,
    len: 1,
    tip: "The camera moves forward as the shot ends",
  },
  {
    id: "pull",
    title: "Pull back",
    cat: "Move",
    move: "push",
    a: -1,
    len: 1,
    tip: "The camera backs away as the shot ends",
  },
  {
    id: "carryLaunch",
    pair: "carryLaunch",
    title: "Launch out",
    cat: "Move",
    move: "push",
    a: 1.25,
    len: 0.45,
    tip: "Stretched-exponential launch concentrating acceleration right at the cut (pairs with Carry in)",
  },
  {
    id: "rise",
    title: "Rise",
    cat: "Move",
    move: "rise",
    a: 1,
    len: 1,
    tip: "Lifts away as the shot ends",
  },
  {
    id: "lower",
    title: "Lower",
    cat: "Move",
    move: "rise",
    a: -1,
    len: 1,
    tip: "Sinks away as the shot ends",
  },
  {
    id: "craneUp",
    title: "Crane arc up",
    cat: "Move",
    move: "rise",
    a: 1.25,
    len: 0.9,
    tip: "Vertical crane pedestal up while pitching to hold the subject",
  },
  {
    id: "craneDown",
    title: "Crane arc down",
    cat: "Move",
    move: "rise",
    a: -1.25,
    len: 0.9,
    tip: "Crane pedestal down while tilting to hold the subject",
  },
  {
    id: "cranePush",
    title: "Crane push",
    cat: "Move",
    move: "push",
    a: 1.3,
    len: 0.95,
    tip: "Crane arc combined with a delayed dolly push",
  },
  {
    id: "slideL",
    title: "Slide left",
    cat: "Move",
    move: "slide",
    a: -1,
    len: 1,
    flip: true,
    tip: "Travels left out of the frame",
  },
  {
    id: "slideR",
    title: "Slide right",
    cat: "Move",
    move: "slide",
    a: 1,
    len: 1,
    flip: true,
    tip: "Travels right out of the frame",
  },
  {
    id: "orbitL",
    title: "Orbit left",
    cat: "Move",
    move: "orbit",
    a: -1,
    len: 1.2,
    flip: true,
    tip: "Arcs left around the subject as the shot ends",
  },
  {
    id: "orbitR",
    title: "Orbit right",
    cat: "Move",
    move: "orbit",
    a: 1,
    len: 1.2,
    flip: true,
    tip: "Arcs right around the subject as the shot ends",
  },
  {
    id: "isoToFlat",
    title: "Flat to iso",
    cat: "Move",
    move: "tilt",
    a: 1.3,
    len: 0.95,
    tip: "Tilt up from eye-level into a high isometric overhead view",
  },
  {
    id: "zoomIn",
    title: "Zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1,
    len: 0.8,
    tip: "The lens tightens as the shot ends",
  },
  {
    id: "zoomOut",
    title: "Zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1,
    len: 0.8,
    tip: "The lens widens as the shot ends",
  },
  {
    id: "logZoomIn",
    title: "Log zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1.2,
    len: 0.7,
    tip: "True logarithmic FOV tighten into the cut",
  },
  {
    id: "logZoomOut",
    title: "Log zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1.2,
    len: 0.7,
    tip: "True logarithmic FOV pull-out into the cut",
  },
  {
    id: "snapZoomIn",
    title: "Snap zoom in",
    cat: "Zoom",
    move: "push",
    a: 1.4,
    len: 0.5,
    optics: true,
    tip: "Slow build then steep snap zoom forward with micro-defocus into the cut",
  },
  {
    id: "snapZoomOut",
    title: "Snap zoom out",
    cat: "Zoom",
    move: "push",
    a: -1.4,
    len: 0.5,
    optics: true,
    tip: "Slow build then steep snap zoom pull-back with micro-defocus into the cut",
  },
  {
    id: "reversal",
    title: "Reversal",
    cat: "Zoom",
    move: "push",
    a: 1.35,
    len: 0.75,
    tip: "Pull back 15% for anticipation, pause, then launch forward into the cut",
  },
  {
    id: "zoomThrough",
    pair: "zoomThrough",
    title: "Zoom through",
    cat: "Zoom",
    move: "push",
    a: 1.6,
    len: 0.45,
    tip: "Exponential zoom push through the subject into the cut (pairs with next shot's In)",
  },
  {
    id: "zoomOutExit",
    pair: "zoomOutExit",
    title: "Zoom out exit",
    cat: "Zoom",
    move: "push",
    a: -1.3,
    len: 0.45,
    tip: "Geometric pull-out acceleration into the cut (pairs with next shot's In)",
  },
  {
    id: "insidePullout",
    title: "Inside pullout",
    cat: "Zoom",
    move: "push",
    a: -1.5,
    len: 0.8,
    tip: "Log-scale pull-out widening away into the cut",
  },
  {
    id: "scaleBreath",
    pair: "scaleBreath",
    title: "Scale breath",
    cat: "Zoom",
    move: "zoom",
    a: 0.45,
    len: 0.4,
    tip: "Subtle 3% accelerating push into the cut (pairs with next shot's In)",
  },
  {
    id: "scaleBreathFlip",
    pair: "scaleBreathFlip",
    title: "Scale breath flip",
    cat: "Zoom",
    move: "zoom",
    a: 0.45,
    len: 0.4,
    tip: "Subtle 5% inward push that flips into an exhale on the next shot (pairs with Scale breath flip)",
  },
  {
    id: "punchOut",
    pair: "punchOut",
    title: "Punch out",
    cat: "Zoom",
    move: "push",
    a: -1.25,
    len: 0.45,
    flip: true,
    tip: "Tight crop accelerating outward into the cut (pairs with next shot's In)",
  },
  {
    id: "panL",
    title: "Pan left",
    cat: "Turn",
    move: "pan",
    a: -1,
    len: 1,
    flip: true,
    tip: "Turns left away from the frame",
  },
  {
    id: "panR",
    title: "Pan right",
    cat: "Turn",
    move: "pan",
    a: 1,
    len: 1,
    flip: true,
    tip: "Turns right away from the frame",
  },
  {
    id: "tiltU",
    title: "Tilt up",
    cat: "Turn",
    move: "tilt",
    a: 1,
    len: 1,
    tip: "Tips up away from the frame",
  },
  {
    id: "tiltD",
    title: "Tilt down",
    cat: "Turn",
    move: "tilt",
    a: -1,
    len: 1,
    tip: "Tips down away from the frame",
  },
  {
    id: "whipL",
    title: "Whip left",
    cat: "Turn",
    move: "whip",
    a: -1,
    len: 0.35,
    flip: true,
    tip: "Snaps away left into the cut",
  },
  {
    id: "whipR",
    title: "Whip right",
    cat: "Turn",
    move: "whip",
    a: 1,
    len: 0.35,
    flip: true,
    tip: "Snaps away right into the cut",
  },
  {
    id: "whipDipL",
    pair: "whipDipL",
    title: "Whip dip left",
    cat: "Turn",
    move: "whip",
    a: -1.15,
    len: 0.38,
    flip: true,
    optics: true,
    tip: "Asymmetric whip pan left with mid-whip FOV widen dip, roll, and directional smear",
  },
  {
    id: "whipDipR",
    pair: "whipDipR",
    title: "Whip dip right",
    cat: "Turn",
    move: "whip",
    a: 1.15,
    len: 0.38,
    flip: true,
    optics: true,
    tip: "Asymmetric whip pan right with mid-whip FOV widen dip, roll, and directional smear",
  },
  {
    id: "roll",
    title: "Roll away",
    cat: "Turn",
    move: "roll",
    a: 1,
    len: 1,
    flip: true,
    tip: "Tips over as the shot ends",
  },
  {
    id: "rollAccent",
    title: "Roll accent",
    cat: "Turn",
    move: "roll",
    a: 0.85,
    len: 0.75,
    flip: true,
    tip: "Push out with a temporary Dutch roll accent that levels back out",
  },
  {
    id: "barrelRoll",
    title: "Barrel roll",
    cat: "Turn",
    move: "roll",
    a: 2.2,
    len: 0.85,
    flip: true,
    tip: "180° barrel roll along the lens axis into the cut",
  },
  {
    id: "spinUp",
    pair: "spinUp",
    title: "Spin up",
    cat: "Turn",
    move: "orbit",
    a: 1.4,
    len: 0.55,
    flip: true,
    tip: "Exponentially accelerating 3D orbit and roll into the cut (pairs with Rotation decay)",
  },
  { id: "fade", title: "Fade out", cat: "Lens & Light", black: true, len: 1, tip: "Ends on black" },
  {
    id: "blackDip",
    pair: "blackDip",
    title: "Black dip whip",
    cat: "Lens & Light",
    black: true,
    move: "whip",
    len: 0.35,
    flip: true,
    tip: "Fast whip exit dipping to 100% black at the cut (pairs with Black dip whip)",
  },
  {
    id: "flashCut",
    pair: "flashCut",
    title: "Flash whip",
    cat: "Lens & Light",
    move: "whip",
    a: -1.1,
    len: 0.35,
    flip: true,
    optics: true,
    tip: "Unbraked smeared whip exit with a 92% white exposure flash at the cut (pairs with Flash whip)",
  },
  {
    id: "exposureBloom",
    pair: "exposureBloom",
    title: "Exposure bloom",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.35,
    len: 0.45,
    optics: true,
    tip: "Frame-wide exposure lift building into the cut (pairs with Exposure bloom)",
  },
  {
    id: "lightSweep",
    title: "Light sweep",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.5,
    len: 0.65,
    flip: true,
    optics: true,
    tip: "Diagonal specular light band sweeping across the lens into the cut",
  },
  {
    id: "blurThrough",
    pair: "blurThrough",
    title: "Blur through",
    cat: "Lens & Light",
    move: "zoom",
    a: -0.4,
    len: 0.45,
    optics: true,
    tip: "Defocus blur ramp with 4% scale shrink into the cut (pairs with Rack focus in)",
  },
  {
    id: "blurBridge",
    pair: "blurBridge",
    title: "Blur bridge",
    cat: "Lens & Light",
    move: "zoom",
    a: -0.6,
    len: 0.25,
    optics: true,
    tip: "Fast 9% pull-back + defocus blur across a hard cut (pairs with Blur bridge)",
  },
  {
    id: "occluderDive",
    pair: "occluderDive",
    title: "Occluder dive",
    cat: "Lens & Light",
    black: true,
    move: "push",
    len: 0.55,
    flip: true,
    optics: true,
    tip: "4.2x log dive with 16° 3D arc, blur and dark occluder wipe into the cut",
  },
  {
    id: "macroDive",
    pair: "macroDive",
    title: "Macro dive out",
    cat: "Lens & Light",
    move: "push",
    a: 1.5,
    len: 0.55,
    flip: true,
    optics: true,
    tip: "Deep 3D logarithmic macro dive with defocus tail and vertical smear into the cut",
  },
  {
    id: "rush",
    pair: "rush",
    title: "Rush out",
    cat: "Lens & Light",
    move: "push",
    a: 1.45,
    len: 0.45,
    optics: true,
    tip: "Doubling-speed rush into the cut with speed-coupled RGB chromatic fringe",
  },
  {
    id: "lensBulge",
    pair: "lensBulge",
    title: "Lens bulge",
    cat: "Lens & Light",
    move: "push",
    a: 1.2,
    len: 0.5,
    optics: true,
    tip: "Fast push-out with barrel lens distortion building into the cut",
  },
  {
    id: "impact",
    title: "Impact",
    cat: "Shake",
    jolt: true,
    len: 0.5,
    flip: true,
    tip: "Ends on a jolt, into the cut",
  },
  {
    id: "impactKick",
    title: "Impact kick",
    cat: "Shake",
    jolt: true,
    len: 0.45,
    flip: true,
    tip: "Directional velocity kick building into the cut",
  },
];

// k (strength, 1 by default) scales a Combo
const COMBO = [
  {
    id: "push",
    title: "Push in",
    cat: "Move",
    move: "push",
    a: 1,
    tip: "Dolly in: the calm, story-telling move toward what it looks at",
  },
  {
    id: "pull",
    title: "Pull back",
    cat: "Move",
    move: "push",
    a: -1,
    tip: "Dolly out: backs away, revealing more of the place",
  },
  {
    id: "rise",
    title: "Rise",
    cat: "Move",
    move: "rise",
    a: 1,
    tip: "Pedestal up, still facing the same way",
  },
  {
    id: "lower",
    title: "Lower",
    cat: "Move",
    move: "rise",
    a: -1,
    tip: "Pedestal down, still facing the same way",
  },
  {
    id: "craneUp",
    title: "Crane arc up",
    cat: "Move",
    move: "rise",
    a: 1.25,
    tip: "Vertical crane pedestal up while pitching to hold the subject",
  },
  {
    id: "craneDown",
    title: "Crane arc down",
    cat: "Move",
    move: "rise",
    a: -1.25,
    tip: "Vertical crane pedestal down while tilting to hold the subject",
  },
  {
    id: "cranePush",
    title: "Crane push",
    cat: "Move",
    move: "push",
    a: 1.3,
    tip: "Crane arc with a delayed dolly push that tightens after the rise starts",
  },
  {
    id: "slideL",
    title: "Slide left",
    cat: "Move",
    move: "slide",
    a: -1,
    flip: true,
    tip: "Truck left, still facing the same way",
  },
  {
    id: "slideR",
    title: "Slide right",
    cat: "Move",
    move: "slide",
    a: 1,
    flip: true,
    tip: "Truck right, still facing the same way",
  },
  {
    id: "zoomHopL",
    title: "Zoom hop left",
    cat: "Move",
    move: "slide",
    a: -1.2,
    flip: true,
    tip: "Slide left while hopping wider in FOV mid-move and tightening on landing",
  },
  {
    id: "zoomHopR",
    title: "Zoom hop right",
    cat: "Move",
    move: "slide",
    a: 1.2,
    flip: true,
    tip: "Slide right while hopping wider in FOV mid-move and tightening on landing",
  },
  {
    id: "reframeChain",
    title: "Reframe chain",
    cat: "Move",
    move: "slide",
    a: 1.3,
    flip: true,
    tip: "Multi-beat chained reframe with fast whip, hold drift, 5% FOV pulse, and velocity lean",
  },
  {
    id: "twoBeatInspect",
    title: "Two-beat inspect",
    cat: "Move",
    move: "push",
    a: 1.25,
    flip: true,
    tip: "Inspect left then right with a 1.55x bell-curve zoom in the middle, returning to frame",
  },
  {
    id: "actionFollow",
    title: "Action follow",
    cat: "Move",
    move: "slide",
    a: 1.2,
    flip: true,
    tip: "Track across the subject with mid-shot zoom-in inspection and banked turn",
  },
  {
    id: "orbitL",
    title: "Orbit left",
    cat: "Move",
    move: "orbit",
    a: -1,
    flip: true,
    tip: "Arcs left around what it looks at",
  },
  {
    id: "orbitR",
    title: "Orbit right",
    cat: "Move",
    move: "orbit",
    a: 1,
    flip: true,
    tip: "Arcs right around what it looks at",
  },
  {
    id: "isoToFlat",
    title: "Iso tilt arc",
    cat: "Move",
    move: "tilt",
    a: 1.3,
    tip: "Arc vertically around the subject between eye-level and isometric pitch",
  },
  {
    id: "swing3D",
    title: "Swing 3D",
    cat: "Move",
    move: "orbit",
    a: 1.3,
    flip: true,
    tip: "3D yaw/pitch swing + push landing at 80%, followed by a 6% slow drift tail",
  },
  {
    id: "panL",
    title: "Pan left",
    cat: "Turn",
    move: "pan",
    a: -1,
    flip: true,
    tip: "Turns left on the spot",
  },
  {
    id: "panR",
    title: "Pan right",
    cat: "Turn",
    move: "pan",
    a: 1,
    flip: true,
    tip: "Turns right on the spot",
  },
  { id: "tiltU", title: "Tilt up", cat: "Turn", move: "tilt", a: 1, tip: "Tips up on the spot" },
  {
    id: "tiltD",
    title: "Tilt down",
    cat: "Turn",
    move: "tilt",
    a: -1,
    tip: "Tips down on the spot",
  },
  {
    id: "whipDipL",
    title: "Whip dip left",
    cat: "Turn",
    move: "whip",
    a: -1.15,
    flip: true,
    optics: true,
    tip: "Asymmetric whip pan left with mid-move FOV widen dip, roll, and directional smear",
  },
  {
    id: "whipDipR",
    title: "Whip dip right",
    cat: "Turn",
    move: "whip",
    a: 1.15,
    flip: true,
    optics: true,
    tip: "Asymmetric whip pan right with mid-move FOV widen dip, roll, and directional smear",
  },
  {
    id: "dutch",
    title: "Dutch drift",
    cat: "Turn",
    move: "roll",
    a: 0.6,
    flip: true,
    tip: "The horizon slowly tips over: unease",
  },
  {
    id: "rollAccent",
    title: "Roll accent",
    cat: "Turn",
    move: "roll",
    a: 0.85,
    flip: true,
    tip: "Push in with a temporary Dutch roll accent that levels out at the end",
  },
  {
    id: "barrelRoll",
    title: "Barrel roll",
    cat: "Turn",
    move: "roll",
    a: 2.2,
    flip: true,
    tip: "Full barrel roll along the forward axis with a push",
  },
  {
    id: "zoomIn",
    title: "Zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1,
    tip: "The lens tightens without the camera moving",
  },
  {
    id: "zoomOut",
    title: "Zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1,
    tip: "The lens widens without the camera moving",
  },
  {
    id: "logZoomIn",
    title: "Log zoom in",
    cat: "Zoom",
    move: "zoom",
    a: 1.2,
    tip: "Logarithmic zoom-in across the whole shot (constant perceived magnification speed)",
  },
  {
    id: "logZoomOut",
    title: "Log zoom out",
    cat: "Zoom",
    move: "zoom",
    a: -1.2,
    tip: "Logarithmic zoom-out across the whole shot",
  },
  {
    id: "snapZoomIn",
    title: "Snap zoom in",
    cat: "Zoom",
    move: "push",
    a: 1.4,
    optics: true,
    tip: "28% slow build, steep snap jump with micro-defocus, 12% glide tail across the shot",
  },
  {
    id: "snapZoomOut",
    title: "Snap zoom out",
    cat: "Zoom",
    move: "push",
    a: -1.4,
    optics: true,
    tip: "Slow build then steep snap zoom pull-back with micro-defocus across the shot",
  },
  {
    id: "reversal",
    title: "Reversal",
    cat: "Zoom",
    move: "push",
    a: 1.35,
    tip: "Pull back 15% for anticipation, pause, then launch forward",
  },
  {
    id: "insidePullout",
    title: "Inside pullout",
    cat: "Zoom",
    move: "push",
    a: -1.5,
    tip: "Log-scale pull-out from tight macro inside the subject to the wide frame",
  },
  {
    id: "vertigoIn",
    title: "Dolly zoom in",
    cat: "Zoom",
    move: "vertigo",
    a: 1,
    tip: "Moves in while the lens widens: the subject keeps its size and the room stretches (Hitchcock's Vertigo)",
  },
  {
    id: "vertigoOut",
    title: "Dolly zoom out",
    cat: "Zoom",
    move: "vertigo",
    a: -1,
    tip: "Backs off while the lens tightens: the subject keeps its size and the room closes in",
  },
  {
    id: "creepIn",
    title: "Living hold in",
    cat: "Zoom",
    move: "zoom",
    a: 0.35,
    tip: "Subtle 4.5% one-way living-hold creep inward so a held shot never freezes dead",
  },
  {
    id: "creepOut",
    title: "Living hold out",
    cat: "Zoom",
    move: "zoom",
    a: -0.35,
    tip: "Subtle 4.5% one-way living-hold creep outward across a held shot",
  },
  {
    id: "breathe",
    title: "Breathe",
    cat: "Zoom",
    loop: "breathe",
    tip: "The lens slowly closes in and eases off, like a held breath",
  },
  {
    id: "macroDive",
    title: "Macro dive",
    cat: "Lens & Light",
    move: "push",
    a: 1.5,
    flip: true,
    optics: true,
    tip: "Deep logarithmic macro dive with 16° 3D arc, defocus tail, and vertical smear",
  },
  {
    id: "defocusPulse",
    title: "Defocus pulse",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.75,
    optics: true,
    tip: "Smooth sine defocus pulse with a scale jump hidden at peak blur",
  },
  {
    id: "exposureBloom",
    title: "Exposure bloom",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.35,
    optics: true,
    tip: "Warm overexposure bloom wave peaking mid-shot during a gentle push",
  },
  {
    id: "rush",
    title: "Rush fringe",
    cat: "Lens & Light",
    move: "push",
    a: 1.45,
    optics: true,
    tip: "High-speed push with speed-coupled RGB chromatic aberration peaking mid-move",
  },
  {
    id: "lightSweep",
    title: "Light sweep",
    cat: "Lens & Light",
    move: "zoom",
    a: 0.5,
    flip: true,
    optics: true,
    tip: "Diagonal specular light band sweeping across the frame during a slow push",
  },
  {
    id: "lensBulge",
    title: "Lens bulge",
    cat: "Lens & Light",
    move: "push",
    a: 1.2,
    optics: true,
    tip: "Push-in with speed-coupled barrel lens bulge peaking mid-move and flattening at rest",
  },
  {
    id: "handheld",
    title: "Handheld",
    cat: "Shake",
    loop: "handheld",
    flip: true,
    tip: "A hand-held camera's slow wander: documentary, found footage",
  },
  {
    id: "shake",
    title: "Shake",
    cat: "Shake",
    loop: "shake",
    flip: true,
    tip: "A steady fine tremble: engines, rumbling, fear",
  },
  {
    id: "sway",
    title: "Sway",
    cat: "Shake",
    loop: "sway",
    flip: true,
    tip: "Rocks side to side: a ship, dizziness, a drunk view",
  },
  {
    id: "figureEight",
    title: "Figure-8 float",
    cat: "Shake",
    loop: "figureEight",
    flip: true,
    tip: "Seamless Lissajous figure-8 camera float that loops back cleanly to its start",
  },
  {
    id: "impactKick",
    title: "Impact kick",
    cat: "Shake",
    jolt: true,
    flip: true,
    tip: "Directional impact kick with decaying 1.5% FOV punch",
  },
];

export const ANIMS = { in: IN, out: OUT, combo: COMBO };
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const FX = { in: byId(IN), out: byId(OUT), combo: byId(COMBO) };

const Y = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3(),
  right = new THREE.Vector3(),
  up = new THREE.Vector3(),
  v = new THREE.Vector3();
// The camera's own axes; returns how far it stands from what it looks at
const frame = (c) => {
  fwd.copy(c.l).sub(c.p);
  const dist = Math.max(0.1, fwd.length());
  fwd.divideScalar(dist);
  right.copy(fwd).cross(Y);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  up.copy(right).cross(fwd);
  return dist;
};
const deg = (x) => (x * Math.PI) / 180;
const lens = (fov) => THREE.MathUtils.clamp(fov, 5, 120);
const logZoom = (c, a) => {
  c.fov = lens(c.fov * Math.exp(-a));
};

// Cubic Bezier evaluator matching Cinetic's `bz(x1, y1, x2, y2)`.
const bz = (x1, y1, x2, y2) => (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const inv = 1 - u;
    const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u - t;
    const dx = 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - x / dx));
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
};

const E_SNAP_OUT = bz(0.137, 0.758, 0.128, 0.926);
const E_GLIDE_OUT = bz(0.172, 0.687, 0.393, 0.943);
const E_BUILD_IN = bz(0.525, 0.079, 0.724, 0.331);
const E_LAUNCH_IN = bz(0.556, 0.053, 0.835, 0.188);

const STD_IN_OUT = [0, 0.04, 0.127, 0.316, 0.55, 0.756, 0.871, 0.924, 0.962, 0.986, 1];
const WHIP_BUILD = [0, 0.017, 0.041, 0.083, 0.143, 0.279, 0.522, 0.757, 0.902, 0.976, 1];
const sampleTable = (table, u) => {
  const x = Math.min(1, Math.max(0, u)) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
};

const snapCurve = (u) => {
  if (u < 0.38) return 0.28 * E_BUILD_IN(u / 0.38);
  if (u < 0.47) {
    const x = (u - 0.38) / 0.09;
    return 0.28 + 0.6 * x * x * (3 - 2 * x);
  }
  return 0.88 + 0.12 * E_GLIDE_OUT((u - 0.47) / 0.53);
};
const reversalCurve = (u, curved = false) => {
  if (u < 0.36) return -0.35 * (curved ? u / 0.36 : E_SNAP_OUT(u / 0.36));
  if (u < 0.46) return -0.35;
  return -0.35 + 1.35 * (curved ? (u - 0.46) / 0.54 : E_LAUNCH_IN((u - 0.46) / 0.54));
};
const carryCurve = (u) => {
  const x = Math.min(1, Math.max(0, u));
  const raw = 0.6 * Math.pow(0.04, x) + 0.4 * Math.pow(0.28, x);
  const end = 0.6 * 0.04 + 0.4 * 0.28;
  return 1 - (raw - end) / (1 - end);
};
const launchCurve = (u) => {
  const x = Math.min(1, Math.max(0, u));
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.exp(-4.6 * Math.pow(1 - x, 0.76));
};
const swingDriftCurve = (u) =>
  u <= 0.8 ? 0.94 * E_SNAP_OUT(u / 0.8) : 0.94 + 0.06 * ((u - 0.8) / 0.2);

// Helpers for Cinetic 3D moves
const dolly = (c, a) => {
  const d = frame(c);
  c.p.addScaledVector(fwd, a * d);
};
const slide2D = (c, x, y) => {
  const d = frame(c);
  c.p.addScaledVector(right, x * d).addScaledVector(up, y * d);
  c.l.addScaledVector(right, x * d).addScaledVector(up, y * d);
};
const pan2D = (c, yawDeg, pitchDeg) => {
  const d = frame(c);
  v.copy(fwd);
  if (yawDeg) v.applyAxisAngle(Y, deg(yawDeg));
  if (pitchDeg) v.applyAxisAngle(right, deg(pitchDeg));
  c.l.copy(c.p).addScaledVector(v, d);
};
const orbit2D = (c, yawDeg, pitchDeg) => {
  frame(c);
  v.copy(c.p).sub(c.l);
  if (yawDeg) v.applyAxisAngle(Y, deg(yawDeg));
  if (pitchDeg) v.applyAxisAngle(right, deg(pitchDeg));
  c.p.copy(c.l).add(v);
};

// Original base moves at amount a: 1 is its full size at strength 1, the sign its way (+ right, up, forward, tighter)
const MOVES = {
  push: (c, a) => {
    const d = frame(c);
    c.p.addScaledVector(fwd, 0.15 * d * a);
  },
  slide: (c, a) => {
    const d = frame(c);
    v.copy(right).multiplyScalar(0.12 * d * a);
    c.p.add(v);
    c.l.add(v);
  },
  rise: (c, a) => {
    const d = frame(c);
    c.p.y += 0.12 * d * a;
    c.l.y += 0.12 * d * a;
  },
  orbit: (c, a) => {
    v.copy(c.p)
      .sub(c.l)
      .applyAxisAngle(Y, deg(12 * a));
    c.p.copy(c.l).add(v);
  },
  pan: (c, a) => {
    const d = frame(c);
    v.copy(fwd).applyAxisAngle(Y, deg(-8 * a));
    c.l.copy(c.p).addScaledVector(v, d);
  },
  whip: (c, a) => {
    const d = frame(c);
    v.copy(fwd).applyAxisAngle(Y, deg(-40 * a));
    c.l.copy(c.p).addScaledVector(v, d);
  },
  tilt: (c, a) => {
    const d = frame(c);
    v.copy(fwd).applyAxisAngle(right, deg(6 * a));
    c.l.copy(c.p).addScaledVector(v, d);
  },
  zoom: (c, a) => {
    c.fov = lens(c.fov * (1 - 0.2 * a));
  },
  roll: (c, a) => {
    c.roll += 0.14 * a;
  },
  // forward by s of the distance, the lens widened so what it looks at keeps its size on screen: d·tan(fov/2) stays the same
  vertigo: (c, a) => {
    const d = frame(c),
      s = THREE.MathUtils.clamp(0.35 * a, -1, 0.8);
    c.p.addScaledVector(fwd, s * d);
    c.fov = lens((2 * Math.atan(Math.tan(deg(c.fov) / 2) / (1 - s)) * 180) / Math.PI);
  },
};

// Specialized Cinetic coordinate & optical evaluators keyed by `fx.id` (`u` in 0..1 across the effect window; when `curved` is
// true, `u` has already been shaped by the studio's chosen motion curve, so single-ramp presets use `u` directly instead of
// compounding their Auto curve on top, while `raw` stays unwarped so black veils never bounce backwards).
const slotRamp = (u, slot, curved, inFn, outFn, comboFn = outFn) => {
  const e = curved ? u : slot === "in" ? inFn(u) : slot === "out" ? outFn(u) : comboFn(u);
  return slot === "in" ? e - 1 : e;
};
const CINETIC = {
  logZoomIn: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    logZoom(c, 0.35 * a);
  },
  logZoomOut: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    logZoom(c, -0.35 * a);
  },
  snapZoomIn: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, snapCurve, snapCurve) * k;
    logZoom(c, 0.38 * a);
    dolly(c, 0.22 * a);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, Math.sin(Math.PI * u) ** 1.6 * 0.22 * k));
  },
  snapZoomOut: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, snapCurve, snapCurve) * k;
    logZoom(c, -0.38 * a);
    dolly(c, -0.22 * a);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, Math.sin(Math.PI * u) ** 1.6 * 0.22 * k));
  },
  oversizeLand: (c, u, _t, k, _slot, curved) => {
    const d = 1 - Math.exp(-5.5);
    const p = curved ? 1 - u : 1 - (1 - Math.exp(-5.5 * u)) / d;
    logZoom(c, 0.32 * p * k);
    dolly(c, 0.14 * p * k);
    const blurEnv = Math.max(0, 1 - u / 0.75) ** 1.5;
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, blurEnv * 0.48 * k));
  },
  reversal: (c, u, _t, k, slot, curved) => {
    const r = reversalCurve(u, curved),
      a = (slot === "in" ? r - 1 : r) * k;
    logZoom(c, 0.32 * a);
    dolly(c, 0.25 * a);
  },
  zoomThrough: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, carryCurve, launchCurve) * k;
    logZoom(c, 0.65 * a);
    dolly(c, 0.42 * a);
  },
  zoomOutExit: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, carryCurve, E_LAUNCH_IN) * k;
    logZoom(c, -0.35 * a);
    dolly(c, -0.32 * a);
  },
  insidePullout: (c, u, _t, k, slot, curved) => {
    const s = (x) => sampleTable(STD_IN_OUT, x),
      a = slotRamp(u, slot, curved, s, s) * k;
    logZoom(c, -0.52 * a);
    dolly(c, -0.42 * a);
  },
  scaleBreath: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, E_GLIDE_OUT, E_BUILD_IN) * k;
    const s = a < 0 ? 0.08 : 0.03;
    dolly(c, s * a);
    logZoom(c, s * a);
  },
  scaleBreathFlip: (c, u, _t, k, slot, curved) => {
    const p =
      (slot === "in" ? (curved ? 1 - u : 1 - E_GLIDE_OUT(u)) : curved ? u : E_BUILD_IN(u)) * k;
    const s = slot === "in" ? 0.08 : 0.05;
    dolly(c, s * p);
    logZoom(c, s * p);
  },
  creepIn: (c, u, _t, k, _slot, curved) => {
    const s = (curved ? u : u * 0.75 + u * u * (3 - 2 * u) * 0.25) * k;
    dolly(c, 0.045 * s);
    logZoom(c, 0.045 * s);
  },
  creepOut: (c, u, _t, k, _slot, curved) => {
    const s = (curved ? u : u * 0.75 + u * u * (3 - 2 * u) * 0.25) * k;
    dolly(c, -0.045 * s);
    logZoom(c, -0.045 * s);
  },
  punchOut: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, carryCurve, E_LAUNCH_IN) * k;
    logZoom(c, -0.32 * a);
    dolly(c, -0.22 * a);
    slide2D(c, 0.05 * a, 0);
  },
  carryLaunch: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, carryCurve, launchCurve) * k;
    dolly(c, 0.26 * a);
    logZoom(c, 0.2 * a);
  },
  craneUp: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    const d = frame(c);
    c.p.addScaledVector(up, 0.22 * d * a);
    c.l.addScaledVector(up, 0.04 * d * a);
  },
  craneDown: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    const d = frame(c);
    c.p.addScaledVector(up, -0.22 * d * a);
    c.l.addScaledVector(up, -0.04 * d * a);
  },
  cranePush: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    const d = frame(c);
    c.p.addScaledVector(up, 0.2 * d * a);
    const pushAmt = Math.sign(a) * Math.pow(Math.abs(a), 1.35);
    dolly(c, 0.24 * pushAmt);
    logZoom(c, 0.12 * pushAmt);
  },
  isoToFlat: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    orbit2D(c, 0, 38 * a);
    dolly(c, 0.1 * a);
  },
  swing3D: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, swingDriftCurve, swingDriftCurve) * k;
    orbit2D(c, 22 * a, 5 * a);
    dolly(c, 0.2 * a);
    c.roll += deg(2.5 * a);
  },
  rollAccent: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    dolly(c, 0.16 * a);
    c.roll += deg(6 * a + 4.5 * Math.sin(Math.PI * u) * k);
  },
  barrelRoll: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_BUILD_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    c.roll += deg(180 * a);
    dolly(c, 0.14 * a);
  },
  spinUp: (c, u, _t, k, slot, curved) => {
    const a = slotRamp(u, slot, curved, carryCurve, launchCurve) * k;
    orbit2D(c, 32 * a, 6 * a);
    c.roll += deg(14 * a);
    dolly(c, 0.12 * a);
  },
  whipDipL: (c, u, _t, k, slot, curved) => {
    const wb = curved ? u : sampleTable(WHIP_BUILD, u);
    const a = (slot === "in" ? wb - 1 : wb) * k;
    const dip = Math.sin(Math.PI * u) ** 2 * k;
    pan2D(c, 28 * a, 0);
    slide2D(c, -0.14 * a, 0);
    logZoom(c, -0.16 * dip);
    c.roll += deg(-4.5 * dip - 1.5 * a);
    c.optics.smearX -= 0.65 * Math.sin(Math.PI * u) ** 1.6 * k;
  },
  whipDipR: (c, u, _t, k, slot, curved) => {
    const wb = curved ? u : sampleTable(WHIP_BUILD, u);
    const a = (slot === "in" ? wb - 1 : wb) * k;
    const dip = Math.sin(Math.PI * u) ** 2 * k;
    pan2D(c, -28 * a, 0);
    slide2D(c, 0.14 * a, 0);
    logZoom(c, -0.16 * dip);
    c.roll += deg(4.5 * dip + 1.5 * a);
    c.optics.smearX += 0.65 * Math.sin(Math.PI * u) ** 1.6 * k;
  },
  zoomHopL: (c, u, _t, k, _slot, curved) => {
    const a = (curved ? u : sampleTable(STD_IN_OUT, u)) * k;
    const hop = Math.sin(Math.PI * u) ** 2 * k;
    slide2D(c, -0.22 * a, 0);
    pan2D(c, 10 * a, 0);
    logZoom(c, -0.24 * hop);
    dolly(c, -0.12 * hop);
  },
  zoomHopR: (c, u, _t, k, _slot, curved) => {
    const a = (curved ? u : sampleTable(STD_IN_OUT, u)) * k;
    const hop = Math.sin(Math.PI * u) ** 2 * k;
    slide2D(c, 0.22 * a, 0);
    pan2D(c, -10 * a, 0);
    logZoom(c, -0.24 * hop);
    dolly(c, -0.12 * hop);
  },
  reframeChain: (c, u, _t, k, _slot, curved) => {
    let pos = 0,
      vel = 0;
    if (u < 0.44) {
      const bu = u / 0.44;
      pos = 0.48 * (curved ? bu : E_SNAP_OUT(bu));
      vel = Math.sin(Math.PI * bu) ** 2;
    } else if (u < 0.56) {
      pos = 0.48 + 0.04 * ((u - 0.44) / 0.12);
      vel = 0.12;
    } else {
      const bu = (u - 0.56) / 0.44;
      pos = 0.52 + 0.48 * (curved ? bu : E_SNAP_OUT(bu));
      vel = Math.sin(Math.PI * bu) ** 2;
    }
    slide2D(c, 0.22 * pos * k, 0.04 * Math.sin(Math.PI * pos) * k);
    pan2D(c, -14 * pos * k, 0);
    logZoom(c, 0.06 * vel * k);
    c.roll += deg(3.5 * vel * k);
  },
  twoBeatInspect: (c, u, _t, k) => {
    const bell = Math.sin(Math.PI * u) ** 1.4;
    const sweep = Math.sin(2 * Math.PI * u);
    logZoom(c, 0.44 * bell * k);
    dolly(c, 0.18 * bell * k);
    pan2D(c, 9 * sweep * k, 2.5 * bell * k);
    slide2D(c, -0.08 * sweep * k, 0);
  },
  actionFollow: (c, u, _t, k, _slot, curved) => {
    const s = curved ? u : sampleTable(STD_IN_OUT, u);
    const bell = Math.sin(Math.PI * u) ** 1.5;
    slide2D(c, 0.2 * s * k, 0.03 * bell * k);
    pan2D(c, -10 * s * k, 0);
    logZoom(c, 0.32 * bell * k);
    dolly(c, 0.15 * bell * k);
    c.roll += deg(-3 * bell * k);
  },
  impactKick: (c, u, _t, k, slot, curved) => {
    const x = slot === "out" ? 1 - u : u;
    const decay = curved ? 1 - x : Math.max(0.05, Math.exp(-x * 4.5)) * (1 - x);
    const env = decay * Math.sin(x * 18 + 0.4) * k;
    const punch = (curved ? 1 - x : (1 - x) * Math.exp(-x * 3.2)) * k;
    slide2D(c, -0.045 * env, 0.03 * env);
    logZoom(c, 0.06 * punch);
    c.roll += deg(2.2 * env);
  },
  figureEight: (c, u, _t, k) => {
    const th = 2 * Math.PI * u;
    slide2D(c, 0.055 * Math.sin(th) * k, 0.03 * Math.sin(2 * th) * k);
    pan2D(c, -2.2 * Math.sin(th) * k, 0.9 * Math.sin(2 * th) * k);
    c.roll += deg(1.2 * Math.sin(th) * k);
  },
  blurThrough: (c, u, _t, k, slot, curved) => {
    const p = curved
      ? slot === "in"
        ? 1 - u
        : u
      : slot === "in"
        ? 1 - E_GLIDE_OUT(u)
        : E_BUILD_IN(u);
    const a = (slot === "in" ? -p : p) * k;
    logZoom(c, -0.06 * a);
    dolly(c, -0.04 * a);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, p * 0.85 * k));
  },
  blurBridge: (c, u, _t, k, slot, curved) => {
    const p = curved
      ? slot === "in"
        ? 1 - u
        : u
      : slot === "in"
        ? 1 - E_SNAP_OUT(u)
        : E_LAUNCH_IN(u);
    const a = (slot === "in" ? -p : p) * k;
    logZoom(c, -0.12 * a);
    dolly(c, -0.09 * a);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, p * 0.95 * k));
  },
  occluderDive: (c, u, _t, k, slot, curved, raw = u) => {
    if (slot === "out") {
      const p = curved ? u : launchCurve(u),
        a = p * k;
      logZoom(c, 0.65 * a);
      dolly(c, 0.42 * a);
      orbit2D(c, 16 * a, -6 * a);
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, u * u * 0.9 * k));
      return Math.max(0, (raw - 0.6) / 0.4) ** 2 * Math.min(1, k);
    }
    const p = curved ? 1 - u : 1 - carryCurve(u),
      a = -p * k;
    slide2D(c, 0, 0.16 * a);
    dolly(c, 0.25 * a);
    logZoom(c, 0.28 * a);
    const uBlur = Math.max(0, (u - 0.12) / 0.88);
    c.optics.blur = Math.max(
      c.optics.blur,
      Math.min(1, (curved ? 1 - uBlur : 1 - E_GLIDE_OUT(uBlur)) * 0.85 * k),
    );
    return Math.max(0, 1 - raw * 3.5) * Math.min(1, k);
  },
  macroDive: (c, u, _t, k, slot, curved) => {
    if (slot === "in") {
      const p = curved ? 1 - u : 1 - carryCurve(u),
        a = p * k;
      logZoom(c, 1.35 * a);
      dolly(c, 0.38 * a);
      orbit2D(c, -16 * a, 5 * a);
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, Math.max(0, 1 - u / 0.65) * 0.85 * k));
      c.optics.smearY += 0.35 * p * k;
      return;
    }
    if (slot === "combo") {
      const p = curved ? u : sampleTable(STD_IN_OUT, u),
        v = Math.sin(Math.PI * u) ** 2,
        a = p * k;
      logZoom(c, 1.435 * a);
      dolly(c, 0.42 * a);
      orbit2D(c, 16 * a, -5 * a);
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, v * 0.55 * k));
      c.optics.smearY -= 0.35 * v * k;
      return;
    }
    const p = curved ? u : launchCurve(u),
      a = p * k;
    logZoom(c, 1.435 * a);
    dolly(c, 0.42 * a);
    orbit2D(c, 16 * a, -5 * a);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, Math.max(0, (u - 0.52) / 0.48) * 0.85 * k));
    c.optics.smearY -= 0.35 * p * k;
  },
  defocusPulse: (c, u, _t, k, _slot, curved) => {
    const pulse = Math.sin(Math.PI * u) ** 2;
    const step = curved
      ? THREE.MathUtils.clamp((u - 0.32) / 0.36, 0, 1)
      : THREE.MathUtils.smoothstep(u, 0.32, 0.68);
    logZoom(c, (0.22 * step + 0.04 * u) * k);
    dolly(c, (0.14 * step + 0.03 * u) * k);
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, pulse * 0.88 * k));
  },
  rush: (c, u, _t, k, slot, curved) => {
    if (slot === "out") {
      const p = curved ? u : launchCurve(u);
      dolly(c, 0.35 * p * k);
      logZoom(c, 0.28 * p * k);
      c.optics.fringe = Math.max(c.optics.fringe, Math.min(1, p * 0.9 * k));
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, p * 0.32 * k));
      return;
    }
    if (slot === "in") {
      const p = curved ? 1 - u : 1 - carryCurve(u);
      dolly(c, -0.35 * p * k);
      logZoom(c, -0.28 * p * k);
      c.optics.fringe = Math.max(c.optics.fringe, Math.min(1, p * 0.9 * k));
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, p * 0.32 * k));
      return;
    }
    const s = curved ? u : sampleTable(STD_IN_OUT, u),
      v = Math.sin(Math.PI * u) ** 2;
    dolly(c, 0.3 * s * k);
    logZoom(c, 0.22 * s * k);
    c.optics.fringe = Math.max(c.optics.fringe, Math.min(1, 0.88 * v * k));
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, v * 0.25 * k));
  },
  flashCut: (c, u, _t, k, slot, curved) => {
    if (slot === "out") {
      const p = curved ? u : u * u;
      pan2D(c, -22 * p * k, 0);
      slide2D(c, -0.18 * p * k, 0);
      logZoom(c, 0.18 * p * k);
      c.optics.exposure = Math.max(
        c.optics.exposure,
        Math.min(1, (curved ? u : Math.pow(u, 1.8)) * 0.92 * k),
      );
      c.optics.smearX -= 0.75 * p * k;
      return;
    }
    const p = curved ? 1 - u : 1 - E_SNAP_OUT(u);
    pan2D(c, 22 * p * k, 0);
    slide2D(c, 0.18 * p * k, 0);
    logZoom(c, -0.25 * p * k);
    dolly(c, -0.2 * p * k);
    c.optics.exposure = Math.max(
      c.optics.exposure,
      Math.min(1, (curved ? 1 - u : Math.pow(1 - u, 2.4)) * 0.92 * k),
    );
    c.optics.smearX += 0.75 * p * k;
  },
  blackDip: (c, u, _t, k, slot, curved, raw = u) => {
    if (slot === "out") {
      const p = curved ? u : E_LAUNCH_IN(u);
      pan2D(c, -20 * p * k, 0);
      dolly(c, 0.16 * p * k);
      return Math.pow(raw, 2.4) * Math.min(1, k);
    }
    const p = curved ? 1 - u : 1 - E_SNAP_OUT(u);
    pan2D(c, 20 * p * k, 0);
    dolly(c, -0.16 * p * k);
    return Math.max(0, 1 - raw * 2.2) * Math.min(1, k);
  },
  exposureBloom: (c, u, _t, k, slot, curved) => {
    if (slot === "combo") {
      const bell = Math.sin(Math.PI * u) ** 1.5,
        s = curved ? u : sampleTable(STD_IN_OUT, u);
      dolly(c, 0.08 * s * k);
      logZoom(c, 0.06 * bell * k);
      c.optics.exposure = Math.max(c.optics.exposure, Math.min(1, bell * 0.62 * k));
      c.optics.blur = Math.max(c.optics.blur, Math.min(1, bell * bell * 0.2 * k));
      return;
    }
    const p = slot === "in" ? (curved ? 1 - u : 1 - E_GLIDE_OUT(u)) : curved ? u : E_BUILD_IN(u);
    const a = (slot === "in" ? -p : p) * k;
    dolly(c, 0.05 * a);
    logZoom(c, 0.05 * a);
    c.optics.exposure = Math.max(c.optics.exposure, Math.min(1, p * 0.68 * k));
    c.optics.blur = Math.max(c.optics.blur, Math.min(1, p * p * 0.25 * k));
  },
  lightSweep: (c, u, _t, k, slot, curved) => {
    const a =
      slotRamp(u, slot, curved, E_SNAP_OUT, E_LAUNCH_IN, (x) => sampleTable(STD_IN_OUT, x)) * k;
    dolly(c, 0.1 * a);
    logZoom(c, 0.08 * a);
    c.optics.sweepPos = u;
    c.optics.sweep = Math.max(c.optics.sweep, Math.min(1, Math.sin(Math.PI * u) * 0.82 * k));
  },
  lensBulge: (c, u, _t, k, slot, curved) => {
    const p = curved
      ? slot === "in"
        ? 1 - u
        : u
      : slot === "in"
        ? 1 - E_SNAP_OUT(u)
        : slot === "out"
          ? E_LAUNCH_IN(u)
          : sampleTable(STD_IN_OUT, u);
    const a = (slot === "in" ? -p : p) * k;
    const bulgeEnv = slot === "combo" ? Math.sin(Math.PI * u) ** 1.5 : p;
    dolly(c, 0.22 * a);
    logZoom(c, 0.16 * a);
    const b = Math.min(1, Math.max(-1, 0.58 * bulgeEnv * k));
    if (Math.abs(b) > Math.abs(c.optics.bulge)) c.optics.bulge = b;
  },
};

// Two or three sines at unrelated rates, so a shake never repeats visibly; the same t always gives the same offset
const wander = (t, f, ph) =>
  Math.sin(t * f + ph) * 0.6 +
  Math.sin(t * f * 2.17 + ph * 1.7 + 1.3) * 0.3 +
  Math.sin(t * f * 3.91 + ph * 0.4 + 2.1) * 0.1;
const nudge = (c, t, f, amp, look) => {
  frame(c);
  const x = wander(t, f, 0.3) * amp,
    y = wander(t, f * 1.13, 2.2) * amp;
  c.p.addScaledVector(right, x).addScaledVector(up, y);
  c.l.addScaledVector(right, x * look).addScaledVector(up, y * look);
};
const LOOPS = {
  handheld: (c, t, k) => {
    nudge(c, t, 1.1, 0.012 * k, 1.8);
    c.roll += 0.006 * k * wander(t, 0.7, 4.1);
  },
  shake: (c, t, k) => {
    nudge(c, t, 13, 0.004 * k, 1.2);
  },
  sway: (c, t, k) => {
    c.roll += 0.05 * k * Math.sin(t * 1.25);
  },
  breathe: (c, t, k) => {
    c.fov = lens(c.fov * (1 - 0.03 * k * (0.5 - 0.5 * Math.cos(t * 0.8))));
  },
};
// A jolt of size e (0 to 1): the impact shake, sideways, up and a little roll
const jolt = (c, t, e) => {
  nudge(c, t, 31, 0.035 * e, 1);
  c.roll += 0.02 * e * Math.sin(t * 43.7 + 0.3);
};

const smooth = (x) => x * x * (3 - 2 * x) * 0.6 + x * 0.4; // film-stage EASES.smooth: a Combo never stops dead at either end
const smoothstep = (x) => x * x * (3 - 2 * x);

// The curve picker's four time warps: [0..1] in, [0..1] out. Linear, smooth and snap are monotonic; bounce rebounds in [0..1],
// so a black veil keeps its own unwarped ramp (see CINETIC and the In/Out below) and never flickers. On an Out slot, snap and
// bounce accelerate from rest into the cut instead of jerking mid-shot and braking before the cut.
const bounceOut = (x) => {
  const n = 7.5625,
    d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const CURVES = {
  linear: (u) => u,
  smooth: smoothstep,
  snap: (u, out) => (out ? u * u * u : 1 - Math.pow(1 - u, 3)),
  glide: (u, out) => (out ? E_BUILD_IN(u) : E_GLIDE_OUT(u)),
  whip: (u) => sampleTable(WHIP_BUILD, u),
  launch: (u, out) => (out ? launchCurve(u) : carryCurve(u)),
  bounce: (u, out) => (out ? 1 - bounceOut(1 - u) : bounceOut(u)),
};
const warp = (curve, u, slot) => {
  const x = Math.min(1, Math.max(0, u));
  if (Array.isArray(curve) && curve.length === 4)
    return bz(curve[0], curve[1], curve[2], curve[3])(x);
  if (curve && CURVES[curve]) return CURVES[curve](x, slot === "out");
  if (typeof curve === "string" && EASES[curve]) return EASES[curve](x);
  return u;
};

// Mirror a move across the camera's own right axis, keeping what the effect did forward, to the lens and to the frame's black
// veil. Effects are built from a base camera each frame, so the mirror runs on the delta from that base.
const baseP = new THREE.Vector3(),
  baseL = new THREE.Vector3(),
  baseR = new THREE.Vector3(),
  delta = new THREE.Vector3();
const baseAt = (c) => {
  baseP.copy(c.p);
  baseL.copy(c.l);
  baseR.copy(c.l).sub(c.p);
  if (baseR.lengthSq() < 1e-8) baseR.set(0, 0, -1);
  baseR.normalize().cross(Y);
  if (baseR.lengthSq() < 1e-8) baseR.set(1, 0, 0);
  baseR.normalize();
  return { p: baseP, l: baseL, right: baseR, roll: c.roll };
};
const mirror = (c, base) => {
  const across = delta.copy(c.p).sub(base.p).dot(base.right);
  const dp = delta
    .copy(c.p)
    .sub(base.p)
    .addScaledVector(base.right, -2 * across);
  c.p.copy(base.p).add(dp);
  const acrossL = delta.copy(c.l).sub(base.l).dot(base.right);
  const dl = delta
    .copy(c.l)
    .sub(base.l)
    .addScaledVector(base.right, -2 * acrossL);
  c.l.copy(base.l).add(dl);
  c.roll = base.roll - (c.roll - base.roll);
};

// Optics slider: blend the optical state an effect wrote (blur, exposure, fringe, bulge, sweep) away from the state before it,
// leaving the camera move and sweepPos alone. 1 is the tuned effect, 0 keeps the picture sharp.
const cleanZero = (x) => (Math.abs(x) < 1e-12 ? 0 : x);
const opticsBefore = { blur: 0, exposure: 0, fringe: 0, bulge: 0, sweep: 0, smearX: 0, smearY: 0 };
const rememberOptics = (c) => {
  opticsBefore.blur = c.optics.blur;
  opticsBefore.exposure = c.optics.exposure;
  opticsBefore.fringe = c.optics.fringe;
  opticsBefore.bulge = c.optics.bulge;
  opticsBefore.sweep = c.optics.sweep;
  opticsBefore.smearX = c.optics.smearX;
  opticsBefore.smearY = c.optics.smearY;
};
const scaleOptics = (c, amount) => {
  const o = c.optics,
    s = Math.min(1, Math.max(0, amount));
  o.blur = opticsBefore.blur + (o.blur - opticsBefore.blur) * s;
  o.exposure = opticsBefore.exposure + (o.exposure - opticsBefore.exposure) * s;
  o.fringe = opticsBefore.fringe + (o.fringe - opticsBefore.fringe) * s;
  o.bulge = opticsBefore.bulge + (o.bulge - opticsBefore.bulge) * s;
  o.sweep = opticsBefore.sweep + (o.sweep - opticsBefore.sweep) * s;
  o.smearX = cleanZero(opticsBefore.smearX + (o.smearX - opticsBefore.smearX) * s);
  o.smearY = cleanZero(opticsBefore.smearY + (o.smearY - opticsBefore.smearY) * s);
};
// Run one effect with its flip and optics choices; returns what it says the frame's black should be
const effect = (c, fx, run) => {
  const base = fx.flip ? baseAt(c) : null,
    optics = fx.optics !== undefined;
  const sweepBefore = c.optics.sweep,
    smearXBefore = c.optics.smearX;
  if (optics) rememberOptics(c);
  const black = run();
  if (base) {
    mirror(c, base);
    if (c.optics.sweep > sweepBefore) c.optics.sweepPos = 1 - c.optics.sweepPos;
    const dx = c.optics.smearX - smearXBefore;
    if (dx !== 0) c.optics.smearX = cleanZero(smearXBefore - dx);
  }
  if (optics) scaleOptics(c, fx.optics);
  return black ?? 0;
};

// How far through the shot's In (x 0 to 1) the effect still is: an arrival slows into the keyed frame, a whip snaps into it
const leftOf = (fx, x) =>
  fx.black ? 1 - smoothstep(x) : Math.pow(1 - x, fx.move === "whip" ? 4 : 2.2);
// and through its Out: a leaving speeds up into the cut
const grownBy = (fx, x) => (fx.black ? smoothstep(x) : Math.pow(x, fx.move === "whip" ? 4 : 2.2));

export function fitAnimationLengths(inLen: number, outLen: number, span: number): [number, number] {
  const a = Math.max(0, inLen),
    b = Math.max(0, outLen),
    max = Math.max(0, span),
    total = a + b;
  if (!total || total <= max) return [a, b];
  const scale = max / total;
  return [a * scale, b * scale];
}

// The shot (in `shots`, start times in the seconds draw(t) gets) at t changes the camera c {p, l, fov, roll} in place; returns
// how black the frame should be (0 to 1). end: the film's length, where the last shot ends. `catalogue` lets a film pass its
// own `draw.anims` with custom presets (`apply(c, u, t, k, slot, curved, raw)`) without touching film-stage.
export function animate(c, t, shots, end, catalogue) {
  c.optics = { ...EMPTY_OPTICS };
  let i = -1;
  for (let j = 0; j < (shots?.length ?? 0); j++) if (t >= shots[j].t) i = j;
  const anim = shots?.[i]?.anim;
  if (!anim) return 0;
  const t0 = shots[i].t,
    t1 = i + 1 < shots.length ? shots[i + 1].t : end,
    span = Math.max(1e-3, t1 - t0);
  const pick = (slot, id) => id && (catalogue?.[slot]?.find((x) => x.id === id) ?? FX[slot][id]);
  const fxIn = pick("in", anim.in?.fx),
    fxOut = pick("out", anim.out?.fx),
    fxCombo = pick("combo", anim.combo?.fx);
  let black = 0;
  if (fxCombo) {
    const k = anim.combo.k ?? 1,
      raw = THREE.MathUtils.clamp((t - t0) / span, 0, 1),
      curved = Boolean(anim.combo.curve),
      u = warp(anim.combo.curve, raw, "combo");
    black = Math.max(
      black,
      effect(c, anim.combo, () => {
        const cin = fxCombo.apply ?? CINETIC[fxCombo.id];
        if (cin) return cin(c, u, t, k, "combo", curved, raw);
        if (fxCombo.loop) {
          LOOPS[fxCombo.loop](c, t, k);
          return 0;
        }
        MOVES[fxCombo.move](c, fxCombo.a * k * (curved ? u : smooth(raw)));
        return 0;
      }),
    );
  }
  // An In and an Out longer together than the shot share it, each shortened in step
  let lenIn = fxIn ? Math.max(0.01, anim.in.len ?? fxIn.len) : 0,
    lenOut = fxOut ? Math.max(0.01, anim.out.len ?? fxOut.len) : 0;
  if (lenIn + lenOut > span) {
    const s = span / (lenIn + lenOut);
    lenIn *= s;
    lenOut *= s;
  }
  // e: how much of the effect is on (0 to 1). An In's camera starts back along its way of travel (way -1), an Out's goes on
  const at = (fx, opt, u, e, way, k, slot, curved, raw) => {
    black = Math.max(
      black,
      effect(c, opt, () => {
        const cin = fx.apply ?? CINETIC[fx.id];
        if (cin) return cin(c, THREE.MathUtils.clamp(u, 0, 1), t, k, slot, curved, raw);
        if (e <= 0) return 0;
        if (fx.black) return Math.min(1, e * k);
        if (fx.jolt) {
          jolt(c, t, e * k);
          return 0;
        }
        MOVES[fx.move](c, way * fx.a * e * k);
        return 0;
      }),
    );
  };
  if (fxIn && t < t0 + lenIn) {
    const raw = (t - t0) / lenIn,
      pureVeil = Boolean(fxIn.black && !fxIn.move),
      curved = Boolean(anim.in.curve && !pureVeil);
    const u = pureVeil ? raw : warp(anim.in.curve, raw, "in");
    at(
      fxIn,
      anim.in,
      u,
      !curved ? leftOf(fxIn, raw) : 1 - u,
      -1,
      anim.in.k ?? 1,
      "in",
      curved,
      raw,
    );
  }
  if (fxOut && t > t1 - lenOut) {
    const raw = (t - (t1 - lenOut)) / lenOut,
      pureVeil = Boolean(fxOut.black && !fxOut.move),
      curved = Boolean(anim.out.curve && !pureVeil);
    const u = pureVeil ? raw : warp(anim.out.curve, raw, "out");
    at(
      fxOut,
      anim.out,
      u,
      !curved ? grownBy(fxOut, raw) : u,
      1,
      anim.out.k ?? 1,
      "out",
      curved,
      raw,
    );
  }
  return black;
}
