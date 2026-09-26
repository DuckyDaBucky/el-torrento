export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Demo media is initialized lazily from getDb() so middleware never pulls ffmpeg.
}
