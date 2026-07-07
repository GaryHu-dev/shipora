import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import "./QrScanner.css";

export default function QrScanner({ onScan, onClose }: { onScan: (data: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let active = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || !active) return;
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (!active) return;
          if (video.readyState >= 2 && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height);
            if (code && code.data) { onScan(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setError("Can't access the camera. Please allow camera access, or ask your manager for the invite link.");
      }
    })();

    return () => {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line
  }, []);

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted />
      {!error && <div className="scanner-frame" />}
      {!error && <div className="scanner-hint">Point your camera at the QR code</div>}
      {error && <div className="scanner-error">{error}</div>}
      <button className="scanner-close" onClick={onClose}>Cancel</button>
    </div>
  );
}
