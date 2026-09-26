import { NextResponse } from "next/server";
import { assertOwner, audit, readSession } from "@/src/lib/db";
import { getDb } from "@/src/lib/db";
import { planDigest, validateDeploy, type DeployRequest } from "@/src/lib/deploy";
import { readSessionId } from "@/src/lib/http";
import { randomBytes } from "node:crypto";

function requireOwner(req: Request) {
  const user = readSession(readSessionId(req));
  if (!user) return { error: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  try {
    assertOwner(user);
  } catch {
    return { error: NextResponse.json({ error: "Owner access is required." }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const auth = requireOwner(req);
  if (auth.error) return auth.error;
  const plans = getDb()
    .prepare("SELECT id, digest, status, created_at, body_json FROM deploy_plans ORDER BY created_at DESC LIMIT 20")
    .all() as { id: string; digest: string; status: string; created_at: string; body_json: string }[];
  return NextResponse.json({
    plans: plans.map((plan) => ({
      id: plan.id,
      digest: plan.digest,
      status: plan.status,
      createdAt: plan.created_at,
      body: JSON.parse(plan.body_json) as DeployRequest,
    })),
    kubernetes: { available: false, reason: "No Kubernetes cluster is installed on this homelab." },
    agentConfigured: Boolean(process.env.DEPLOY_AGENT_URL),
  });
}

export async function POST(req: Request) {
  const auth = requireOwner(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    plan?: DeployRequest;
    id?: string;
    digest?: string;
  };

  if (body.action === "preview" && body.plan) {
    const issues = validateDeploy(body.plan);
    if (issues.length) return NextResponse.json({ issues }, { status: 422 });
    const digest = planDigest(body.plan);
    const id = `plan_${randomBytes(8).toString("hex")}`;
    getDb()
      .prepare("INSERT INTO deploy_plans (id, body_json, digest, status, created_at) VALUES (?, ?, ?, 'preview', ?)")
      .run(id, JSON.stringify(body.plan), digest, new Date().toISOString());
    audit(auth.user.id, "deploy-preview", id, "ok", body.plan.targetGuest);
    return NextResponse.json({
      id,
      digest,
      plan: body.plan,
      affects: `${body.plan.name} on ${body.plan.targetGuest}`,
    });
  }

  if (body.action === "apply" && body.id && body.digest) {
    const row = getDb()
      .prepare("SELECT digest, status, body_json FROM deploy_plans WHERE id = ?")
      .get(body.id) as { digest: string; status: string; body_json: string } | undefined;
    if (!row) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    if (row.digest !== body.digest) {
      audit(auth.user.id, "deploy-apply", body.id, "rejected", "digest mismatch");
      return NextResponse.json({ error: "Plan changed since preview. Preview again." }, { status: 409 });
    }
    const plan = JSON.parse(row.body_json) as DeployRequest;
    const issues = validateDeploy(plan);
    if (issues.length) return NextResponse.json({ issues }, { status: 422 });
    if (!process.env.DEPLOY_AGENT_URL) {
      getDb().prepare("UPDATE deploy_plans SET status = 'not-configured' WHERE id = ?").run(body.id);
      audit(auth.user.id, "deploy-apply", body.id, "not-configured", null);
      return NextResponse.json(
        { error: "Deployment agent is not configured. Nothing was started." },
        { status: 501 },
      );
    }
    const response = await fetch(`${process.env.DEPLOY_AGENT_URL.replace(/\/$/, "")}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: body.id, digest: body.digest, plan }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    const status = response.ok ? "accepted" : "error";
    getDb().prepare("UPDATE deploy_plans SET status = ? WHERE id = ?").run(status, body.id);
    audit(auth.user.id, "deploy-apply", body.id, status, payload.message ?? null);
    return NextResponse.json({ ok: response.ok, message: payload.message ?? status }, { status: response.status });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
