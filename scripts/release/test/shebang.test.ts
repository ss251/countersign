import { describe, expect, test } from "bun:test";
import { withNodeShebang } from "../shebang.ts";

function shebangLines(source: string): string[] {
  return source.split("\n").filter((line) => line.startsWith("#!"));
}

describe("the Node shebang", () => {
  test("replaces a bun shebang", () => {
    const output = withNodeShebang("#!/usr/bin/env bun\nconsole.log(1);\n");
    expect(output).toBe("#!/usr/bin/env node\nconsole.log(1);\n");
    expect(shebangLines(output)).toEqual(["#!/usr/bin/env node"]);
  });

  test("adds a shebang when missing", () => {
    const output = withNodeShebang("console.log(1);\n");
    expect(output.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(shebangLines(output)).toHaveLength(1);
  });

  test("keeps exactly one line when several shebangs were present", () => {
    const output = withNodeShebang("#!/usr/bin/env bun\n#!/usr/bin/env node\nconsole.log(1);\n");
    expect(shebangLines(output)).toEqual(["#!/usr/bin/env node"]);
    expect(output).toBe("#!/usr/bin/env node\nconsole.log(1);\n");
  });

  test("leaves an existing Node shebang alone", () => {
    const source = "#!/usr/bin/env node\nconsole.log(1);\n";
    expect(withNodeShebang(source)).toBe(source);
  });
});
