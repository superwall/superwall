import assert from "node:assert/strict";
import { test } from "node:test";
import { runApi, runBootstrap } from "@/commands/api";
import { runAsc } from "@/commands/asc";
import { runDoctor } from "@/commands/doctor";
import { runIntegrate, runActionCommand } from "@/commands/integrate";
import { runMigrate } from "@/commands/migrate";
import { runQuery } from "@/commands/query";
import { runResource } from "@/commands/resource";
import { runSkills } from "@/commands/skills";
import { runLogin, runLogout, runWhoami } from "@/commands/auth";

test("every data command declares authentication and JSON policies centrally", () => {
  const dataCommands = [
    runApi("get"),
    runApi("post"),
    runApi("patch"),
    runApi("delete"),
    runBootstrap,
    runAsc,
    runQuery,
    runResource("orgs"),
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
