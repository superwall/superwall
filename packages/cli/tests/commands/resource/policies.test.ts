import assert from "node:assert/strict";
import { test } from "node:test";
import { runApi, runBootstrap } from "@/commands/platform/api";
import { runAsc } from "@/commands/platform/asc";
import { runDoctor } from "@/commands/account/doctor";
import { runIntegrate, runActionCommand } from "@/commands/workflow/integrate";
import { runMigrate } from "@/commands/workflow/migrate";
import { runQuery } from "@/commands/platform/query";
import { runResource } from "@/commands/resource/resource";
import { runSkills } from "@/commands/account/skills";
import { runLogin, runLogout, runWhoami } from "@/commands/account/auth";

test("every data command declares authentication and JSON policies centrally", () => {
  const dataCommands = [
    runApi("get"),
    runApi("post"),
    runApi("patch"),
    runApi("delete"),
    runBootstrap,
    runAsc,
    runQuery,
    runResource("apps"),
    runResource("products"),
    runResource("campaigns"),
    runResource("paywalls"),
    runResource("entitlements"),
  ];

  for (const command of dataCommands) {
    assert.equal(command.definition.auth, "required", command.definition.name);
    assert.equal(command.definition.output, "both", command.definition.name);
  }
  for (const command of [runApi("get"), runBootstrap, runQuery]) {
    assert.equal(command.definition.interaction, "none", command.definition.name);
  }
});

test("account utilities expose JSON while agent workflows stay human-only", () => {
  for (const command of [runLogin, runLogout, runWhoami, runDoctor]) {
    assert.equal(command.definition.output, "both", command.definition.name);
  }

  for (const command of [
    runIntegrate,
    runActionCommand("review"),
    runActionCommand("review-fix"),
    runMigrate,
    runSkills,
  ]) {
    assert.equal(command.definition.output, undefined, command.definition.name);
  }
});
