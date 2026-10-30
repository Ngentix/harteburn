---
name: handoff
description: Hand the work to a fresh conversation at a safe checkpoint - the board and memory brought current, a continuation prompt written to .redcell/handoff.md (and shown in chat), then the owner opens a NEW conversation window (keeping this one open to look back at; never /clear) and types "go", and the new session loads the handoff by itself. Use when the HarteBurn reminder says the context is past its threshold, when an objective closes, or when the owner asks. Never compact instead.
argument-hint: (none)
---

Hand off. **Timebox: 5 min.**

1. **Pick the checkpoint.** Never mid-slice: finish or stop the current step so that everything is
   committed and pushed, and nothing is half-edited. No background job may still be writing to the
   tree.
2. **Bring the durable state current**, since the next session resumes from it:
   - the board (`.redcell/board.json`, then the render, then the page);
   - the project's memory or notes (what is in flight, what is the owner's, what was decided today);
   - an ops fact learned this session (a command, a limit, a procedure, a production setting) goes
     into the repo's runbook or troubleshooting doc, not memory alone: roles and other developers
     read the repo, never your memory;
   - the PRD or plan if it changed.
3. **Write `.redcell/handoff.md`**, the continuation prompt. Keep it short; point at files rather
   than retelling them:
   - repo, branch, the rules that bind this project;
   - the objective and its board record id; where the board says we are;
   - what is in flight (commits, a running job, a release), what is the owner's, and the next 1–3
     steps;
   - anything learned this session that is not in a file yet (then put it in one).
4. **Show it in chat** as one fenced copy-paste block (the owner's standing rule: continuation
   prompts live in chat), and say:
   > Open a new conversation window and type `go`; it loads this handoff by itself. Keep this
   > window open if you want to look back at it, but don't work in it any more.

   ⛔ **Never tell the owner to `/clear`**. The handoff loads once, into whichever session starts next (the hook
   moves it to `handoff.loaded.md`).
5. Never compact.
6. **After the handoff, this session stops working.** Answer questions about what happened, but
   start no new work and make no edits here, so two windows never write to the same tree.
