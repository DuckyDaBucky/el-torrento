import "server-only";

let started = false;

/** Lazy demo torrent simulation. Never import from middleware. */
export function ensureDemoRuntime(): void {
  if (started || process.env.NODE_ENV === "test" || process.env.ELTORRENTO_DEMO === "0") return;
  started = true;
  void import("./media")
    .then(async (media) => {
      await media.ensureDemoFile();
      setInterval(() => {
        try {
          media.advanceDemoPieces();
        } catch {
          /* ignore */
        }
      }, 2000);
    })
    .catch(() => {
      started = false;
    });
}
