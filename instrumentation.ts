export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureDemoFile, advanceDemoPieces } = await import("@/src/lib/media");
  await ensureDemoFile();
  setInterval(() => {
    try {
      advanceDemoPieces();
    } catch {
      /* db not ready */
    }
  }, 2000);
}
