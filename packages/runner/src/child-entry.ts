/**
 * The child entry: read one {spec, input} request on stdin, run the skill and
 * write {output} on stdout. Errors become {error} with a non-zero exit.
 */

import { readSkill, runSkill, type SkillInput } from "./skill.ts";

interface ChildRequest {
  spec: { adapter: "skill"; skillPath: string };
  input: unknown;
}

async function main(): Promise<void> {
  const request = parseRequest(await Bun.stdin.text());
  const skill = await readSkill(request.spec.skillPath);
  const output = runSkill(skill, asSkillInput(request.input));
  console.log(JSON.stringify({ output }));
}

function parseRequest(raw: string): ChildRequest {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.spec)) {
    throw new Error("The child request is malformed.");
  }
  const adapter = value.spec.adapter;
  const skillPath = value.spec.skillPath;
  if (adapter !== "skill" || typeof skillPath !== "string") {
    throw new Error("The child request is malformed.");
  }
  return { spec: { adapter, skillPath }, input: value.input };
}

function asSkillInput(value: unknown): SkillInput {
  if (!isRecord(value)) return {};
  const input: SkillInput = {};
  if (typeof value.question === "string") input.question = value.question;
  if (typeof value.section === "string") input.section = value.section;
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
