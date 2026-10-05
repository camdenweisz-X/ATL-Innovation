import { useEffect, useRef, useState } from "react";
import { Button, Sheet } from "../ui/kit";
import { Icon } from "../ui/icons";
import { useT } from "../lib/i18n";
import type { Video } from "./Report";

/** Phones and tablets open their own camera app from a file input with `capture`. */
function usesNativeCamera() {
  return window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}

/**
 * Photo area on the report screen: take a photo now (camera) or choose one from the library.
 * Phones get the native camera; computers get a live webcam view in a sheet.
 */
export function PhotoPicker({ thumb, onPick, onRemove }: { thumb: string | null; onPick: (b: Blob) => void; onRemove: () => void }) {
  const { t } = useT();
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
        {thumb ? <img className="thumb" src={thumb} alt={t("Your photo of the problem")} /> : <span className="thumb"><Icon name="camera" /></span>}
        <div className="grow stack-sm">
          <div>
            <span className="h3" style={{ display: "block" }}>{thumb ? t("Photo added") : t("Add a photo")}</span>
            <span className="small muted">{thumb ? t("Retake it or pick a different one.") : t("A clear photo helps maintenance fix it the first time.")}</span>
          </div>
          <div className="row-wrap photo-actions">
            <Button type="button" size="sm" icon="camera" onClick={takePhoto}>{thumb ? t("Retake") : t("Take photo")}</Button>
            <Button type="button" size="sm" variant="secondary" icon="image" onClick={() => libraryInput.current?.click()}>{thumb ? t("Choose another") : t("Choose from library")}</Button>
          </div>
        </div>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
        <input ref={libraryInput} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
      </div>
      {thumb && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: -8 }} onClick={onRemove}><Icon name="trash" />{t("Remove photo")}</button>}
      <CameraSheet open={camOpen} onClose={() => setCamOpen(false)} onPhoto={(b) => { setCamOpen(false); onPick(b); }}
        onUseLibrary={() => { setCamOpen(false); libraryInput.current?.click(); }} />
    </>
  );
}

type CamState = { kind: "starting" } | { kind: "live" } | { kind: "shot"; url: string; blob: Blob } | { kind: "error"; msg: string };

function cameraError(e: unknown, t: (s: string) => string): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return t("Camera access is blocked. Allow the camera for this site in your browser's settings, or choose a photo from your library.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("No camera was found on this device. Choose a photo from your library instead.");
  if (name === "NotReadableError") return t("The camera is being used by another app. Close it and try again, or choose a photo instead.");
  return t("The camera couldn't start. Choose a photo from your library instead.");
}

/** Live camera view for computers (and any browser where the native camera isn't available). */
function CameraSheet({ open, onClose, onPhoto, onUseLibrary }: { open: boolean; onClose: () => void; onPhoto: (b: Blob) => void; onUseLibrary: () => void }) {
  const { t } = useT();
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
      } catch (e) { if (alive) setState({ kind: "error", msg: cameraError(e, t) }); }
    })();
    return () => { alive = false; stop(); };
  }, [open, facing]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <Sheet open={open} onClose={onClose} title={t("Take a photo")}>
      <div className="stack">
        {state.kind === "error" ? (
          <>
            <div className="notice warn" role="alert"><Icon name="alert" /><div>{state.msg}</div></div>
            <Button block icon="image" onClick={onUseLibrary}>{t("Choose from library")}</Button>
          </>
        ) : (
          <>
            <div className="cam">
              <video ref={video} playsInline muted autoPlay aria-label={t("Camera preview")} hidden={state.kind === "shot"} />
              {state.kind === "shot" && <img src={state.url} alt={t("The photo you just took")} />}
              {state.kind === "starting" && <div className="cam-msg"><span className="spinner" aria-hidden="true" />{t("Starting camera…")}</div>}
            </div>
            {state.kind === "shot" ? (
              <div className="row-wrap cam-actions">
                <Button variant="secondary" icon="refresh" onClick={retake}>{t("Retake")}</Button>
                <Button icon="check" onClick={() => onPhoto(state.blob)}>{t("Use photo")}</Button>
              </div>
            ) : (
              <div className="row-wrap cam-actions">
                {cams > 1 && <Button variant="secondary" icon="swap" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>{t("Switch camera")}</Button>}
                <Button icon="camera" disabled={state.kind !== "live"} onClick={capture}>{t("Take photo")}</Button>
              </div>
            )}
            <button type="button" className="btn ghost sm" style={{ alignSelf: "center" }} onClick={onUseLibrary}>{t("Choose from library instead")}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Optional short video (leaks, noises, things that come and go): record one now or pick one. */
export function VideoPicker({ video, busy, maxSeconds, onPick, onRemove }: { video: Video | null; busy: boolean; maxSeconds: number; onPick: (f: File) => void; onRemove: () => void }) {
  const { t } = useT();
  const recordInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const fromInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onPick(f);
  };
  return (
    <>
      <div className={`photo-pick ${video ? "has" : ""}`} aria-busy={busy || undefined}>
        {video ? <span className="thumb vid"><img src={video.thumb} alt="" /><Icon name="play" /></span> : <span className="thumb">{busy ? <span className="spinner" /> : <Icon name="video" />}</span>}
        <div className="grow stack-sm">
          <div>
            <span className="h3" style={{ display: "block" }}>{video ? t("Video added ({s} s)", { s: Math.round(video.duration) }) : t("Add a short video")}</span>
            <span className="small muted">{video ? t("Record it again or pick a different one.") : t("Optional. Up to {s} seconds, for leaks, noises or things that come and go.", { s: maxSeconds })}</span>
          </div>
          <div className="row-wrap photo-actions">
            {usesNativeCamera() && <Button type="button" size="sm" variant="secondary" icon="video" disabled={busy} onClick={() => recordInput.current?.click()}>{video ? t("Record again") : t("Record video")}</Button>}
            <Button type="button" size="sm" variant="secondary" icon="image" disabled={busy} onClick={() => libraryInput.current?.click()}>{video ? t("Choose another") : t("Choose a video")}</Button>
          </div>
        </div>
        <input ref={recordInput} type="file" accept="video/*" capture="environment" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
        <input ref={libraryInput} type="file" accept="video/*" hidden tabIndex={-1} aria-hidden="true" onChange={fromInput} />
      </div>
      {video && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: -8 }} onClick={onRemove}><Icon name="trash" />{t("Remove video")}</button>}
    </>
  );
}
