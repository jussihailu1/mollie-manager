export async function GET() {
  return Response.json({
    app: "Mollie Manager",
    phase: "foundation",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
