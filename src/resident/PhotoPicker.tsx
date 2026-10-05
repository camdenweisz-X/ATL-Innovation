import { useEffect, useRef, useState } from "react";
import { Button, Sheet } from "../ui/kit";
import { Icon } from "../ui/icons";

/** Phones and tablets open their own camera app from a file input with `capture`. */
function usesNativeCamera() {
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}

/**
 * Photo area on the report screen: take a photo now (camera) or choose one from the library.
 * Phones get the native camera; computers get a live webcam view in a sheet.
 */
export function PhotoPicker({ thumb, onPick, onRemove }: { thumb: string | null; onPick: (b: Blob) => void; onRemove: () => void }) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [camOpen, setCamOpen] = useState(false);

  const takePhoto = () => {
    if (usesNativeCamera() || !navigator.mediaDevices?.getUserMedia) cameraInput.current?.click();
    else setCamOpen(true);
  };
  const fromInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // so picking the same photo again still fires
    if (f) onPick(f);
  };

  return (
    <>
      <div className={`photo-pick ${thumb ? "has" : ""}`}>
        {thumb ? <img className="thumb" src={thumb} alt="Your photo of the problem" /> : <span className="thumb"><Icon name="camera" /></span>}
        <div className="grow stack-sm">
          <div>
            <span className="h3" style={{ display: "block" }}>{thumb ? "Photo added" : "Add a photo"}</span>
            <span className="small muted">{thumb ? "Retake it or pick a different one." : "A clear photo helps maintenance fix it the first time."}</span>
          </div>
          <div className="row-wrap photo-actions">
            <Button type="button" size="sm" icon="camera" onClick={takePhoto}>{thumb ? "Retake" : "Take photo"}</Button>
            <Button type="button" size="sm" variant="secondary" icon="image" onClick={() => libraryInput.current?.click()}>{thumb ? "Choose another" : "Choose from library"}</Button>
          </div>
        </div>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
        <input ref={libraryInput} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
      </div>
      {thumb && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: -8 }} onClick={onRemove}><Icon name="trash" />Remove photo</button>}
      <CameraSheet open={camOpen} onClose={() => setCamOpen(false)} onPhoto={(b) => { setCamOpen(false); onPick(b); }}
        onUseLibrary={() => { setCamOpen(false); libraryInput.current?.click(); }} />
    </>
  );
}

type CamState = { kind: "starting" } | { kind: "live" } | { kind: "shot"; url: string; blob: Blob } | { kind: "error"; msg: string };

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow the camera for this site in your browser's settings, or choose a photo from your library.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Choose a photo from your library instead.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again, or choose a photo instead.";
  return "The camera couldn't start. Choose a photo from your library instead.";
}

/** Live camera view for computers (and any browser where the native camera isn't available). */
function CameraSheet({ open, onClose, onPhoto, onUseLibrary }: { open: boolean; onClose: () => void; onPhoto: (b: Blob) => void; onUseLibrary: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>({ kind: "starting" });
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cams, setCams] = useState(0);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ kind: "starting" });
    (async () => {
      try {
        stop();
        const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setState({ kind: "live" });
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (alive) setCams(devices.filter((d) => d.kind === "videoinput").length);
      } catch (e) { if (alive) setState({ kind: "error", msg: cameraError(e) }); }
    })();
    return () => { alive = false; stop(); };
  }, [open, facing]);

  // Free the preview image when it's replaced or the sheet closes.
  useEffect(() => () => { if (state.kind === "shot") URL.revokeObjectURL(state.url); }, [state]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (b) setState({ kind: "shot", url: URL.createObjectURL(b), blob: b }); }, "image/jpeg", 0.92);
  };
  const retake = async () => {
    setState({ kind: "live" });
    if (video.current && stream.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Take a photo">
      <div className="stack">
        {state.kind === "error" ? (
          <>
            <div className="notice warn" role="alert"><Icon name="alert" /><div>{state.msg}</div></div>
            <Button block icon="image" onClick={onUseLibrary}>Choose from library</Button>
          </>
        ) : (
          <>
            <div className="cam">
              <video ref={video} playsInline muted autoPlay aria-label="Camera preview" hidden={state.kind === "shot"} />
              {state.kind === "shot" && <img src={state.url} alt="The photo you just took" />}
              {state.kind === "starting" && <div className="cam-msg"><span className="spinner" aria-hidden="true" />Starting camera…</div>}
            </div>
            {state.kind === "shot" ? (
              <div className="row-wrap cam-actions">
                <Button variant="secondary" icon="refresh" onClick={retake}>Retake</Button>
                <Button icon="check" onClick={() => onPhoto(state.blob)}>Use photo</Button>
              </div>
            ) : (
              <div className="row-wrap cam-actions">
                {cams > 1 && <Button variant="secondary" icon="swap" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>Switch camera</Button>}
                <Button icon="camera" disabled={state.kind !== "live"} onClick={capture}>Take photo</Button>
              </div>
            )}
            <button type="button" className="btn ghost sm" style={{ alignSelf: "center" }} onClick={onUseLibrary}>Choose from library instead</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
