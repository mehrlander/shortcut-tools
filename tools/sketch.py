#!/usr/bin/env python3
"""Render a shortcut as indented pseudocode, so it can be read at a glance.

    python3 tools/sketch.py <file.wflow>
    python3 tools/sketch.py <dump.zip …> --name <Shortcut>
    python3 tools/sketch.py <dump.zip …> --all          # every shortcut, one after another

A shortcut's plist is unreadable at size: `Show-Loop` is 54 KB of XML for 81
actions, most of it serialization scaffolding. The information a reader wants
is the shape: what branches, what loops, what calls out, and where each value
comes from. That is about one short line per action.

The design is the one `Get-Tinycut` already uses on device: a table mapping
each action identifier to a word, with control flow carrying three forms for
the three `WFControlFlowMode` values, and the body indented between them. What
this adds is that it runs where it can be tested, and that it resolves data
flow: a `WFTextTokenAttachment` prints as the line number that produced it
rather than as an object-replacement character with a UUID beside it.

Deliberately lossy. It is a reading aid, not a serialization: parameters are
summarized, long text is reported by length, and nothing here round-trips.
Use `restore.py` to put a shortcut back.
"""
import argparse, json, plistlib, re, sys, zipfile
from pathlib import Path

PREFIX = "is.workflow.actions."

# Control flow: (open, else, close) for WFControlFlowMode 0, 1, 2.
FLOW = {
    "conditional": ("if", "else", "end if"),
    "repeat.count": ("repeat", "", "end repeat"),
    "repeat.each": ("for each", "", "end for each"),
    "choosefrommenu": ("menu", "case", "end menu"),
}

# Everything else: a word, and the parameter worth showing beside it.
VERB = {
    "gettext": ("text", "WFTextActionText"),
    "setvariable": ("set", "WFVariableName"),
    "appendvariable": ("append to", "WFVariableName"),
    "getvariable": ("get", "WFVariable"),
    "runworkflow": ("run", "WFWorkflowName"),
    "comment": ("#", "WFCommentActionText"),
    "getvalueforkey": ("value for", "WFDictionaryKey"),
    "setvalueforkey": ("set key", "WFDictionaryKey"),
    "text.replace": ("replace", "WFReplaceTextFind"),
    "text.split": ("split", "WFTextSeparator"),
    "text.combine": ("join", "WFTextSeparator"),
    "dictionary": ("dict", None),
    "alert": ("alert", "WFAlertActionMessage"),
    "ask": ("ask", "WFAskActionPrompt"),
    "setitemname": ("name it", "WFName"),
    "output": ("output", "WFOutput"),
    "exit": ("stop", None),
    "choosefromlist": ("choose from", "WFChooseFromListActionPrompt"),
    "list": ("list", None),
    "getitemfromlist": ("item", "WFItemIndex"),
    "count": ("count", None),
    "url": ("url", "WFURLActionURL"),
    "downloadurl": ("fetch", "WFURL"),
    "openurl": ("open", "WFInput"),
    "previewdocument": ("preview", None),
    "showresult": ("show", "Text"),
    "detect.text": ("as text", None),
    "gettypeaction": ("as file", "WFFileType"),
    "base64encode": ("base64", "WFEncodeMode"),
    "urlencode": ("urlencode", "WFEncodeMode"),
    "setclipboard": ("clipboard <-", None),
    "getclipboard": ("clipboard", None),
    "getmyworkflows": ("my shortcuts", "Folder"),
    "documentpicker.open": ("get file", "WFGetFilePath"),
    "file.append": ("append file", None),
    "makezip": ("archive", "WFArchiveFormat"),
    "math": ("math", "WFMathOperation"),
    "speaktext": ("speak", None),
    "runjavascriptonwebpage": ("js on page", None),
    "filter.files": ("filter", None),
    "file": ("file", "WFFile"),
    "file.select": ("pick file", None),
    "share": ("share", None),
    "notification": ("notify", "WFNotificationActionBody"),
    "documentpicker.save": ("save file", "WFFileDestinationPath"),
    "detect.dictionary": ("as dict", None),
    "detect.images": ("as image", None),
    "text.match": ("match", "WFMatchTextPattern"),
    "text.changecase": ("case", "WFCaseType"),
    "file.delete": ("delete file", None),
    "file.createfolder": ("mkdir", "WFFilePath"),
    "image.resize": ("resize", "WFImageResizeWidth"),
    "properties.contacts": ("contact", "WFContentItemPropertyName"),
    "viewresult": ("view", None),
    "getitemtype": ("type of", None),
    "getmarkdownfromrichtext": ("as markdown", None),
    "delay": ("wait", "WFDelayTime"),
    "number": ("number", "WFNumberActionNumber"),
    "getbatterylevel": ("battery", None),
    "nothing": ("nothing", None),
    # The next block was added 2026-08-13 after measuring the gap: 247 distinct
    # identifiers had no word, over 1,958 uses. These 26 are the head of that
    # distribution. An unnamed action still prints its raw identifier, so the
    # table is a legibility improvement and never a correctness one.
    "openapp": ("open app", "WFAppIdentifier"),
    "getdevicedetails": ("device", "WFDeviceDetail"),
    "getwebpagecontents": ("page contents", None),
    "showwebpage": ("show page", "WFURL"),
    "getrichtextfromhtml": ("html -> rich", None),
    "gethtmlfromrichtext": ("rich -> html", None),
    "getrichtextfrommarkdown": ("md -> rich", None),
    "file.getfoldercontents": ("folder contents", None),
    "detect.contacts": ("as contacts", None),
    "detect.link": ("as link", None),
    "detect.number": ("as number", None),
    "properties.files": ("file prop", "WFContentItemPropertyName"),
    "date": ("date", "WFDateActionDate"),
    "adjustdate": ("shift date", "WFDuration"),
    "format.date": ("format date", "WFDateFormatStyle"),
    "number.random": ("random", None),
    "selectphoto": ("pick photo", None),
    "image.crop": ("crop", None),
    "calculateexpression": ("eval", None),
    "text.match.getgroup": ("group", "WFGroupIndex"),
    "unzip": ("unzip", None),
    "setvolume": ("volume", "WFVolume"),
    "speak": ("speak", "WFText"),
    "round": ("round", "WFRoundTo"),
    "statistics": ("stats", "WFStatisticsOperation"),
    "returntohomescreen": ("home screen", None),
    # Third-party. Named because the JavaScript transform is load-bearing here:
    # it is how a shortcut runs real code without a data: URL.
    "com.sindresorhus.Actions.TransformTextWithJavaScriptIntent": ("js", "javaScriptCode"),
}


def short(value, produced, limit=48):
    """One readable token for a parameter value.

    A text token is the case that matters: it holds an object-replacement
    character per attachment, and each attachment names the UUID that produced
    it. Printing the producing line instead is what turns a wall of U+FFFC into
    something a reader can follow.
    """
    if isinstance(value, dict):
        v = value.get("Value", value)
        if isinstance(v, dict) and "string" in v:
            s = v["string"]
            for rng, att in sorted((v.get("attachmentsByRange") or {}).items()):
                s = s.replace("￼", ref(att, produced), 1)
            return clip(s, limit)
        if isinstance(v, dict) and ("Type" in v or "OutputUUID" in v):
            return ref(v, produced)
        if isinstance(v, dict) and "WFDictionaryFieldValueItems" in v:
            keys = [short(i.get("WFKey"), produced, 18)
                    for i in v["WFDictionaryFieldValueItems"]]
            return "{%s}" % ", ".join(k for k in keys if k)
        return clip(json.dumps(v, ensure_ascii=False, default=str), limit)
    return clip(str(value), limit)


def ref(att, produced):
    """A variable reference, as the line that produced it."""
    v = att.get("Value", att) if "Value" in att else att
    kind = v.get("Type")
    if kind == "ActionOutput":
        line = produced.get(v.get("OutputUUID"))
        base = "«%s»" % (line if line is not None else v.get("OutputName", "?"))
    elif kind == "Variable":
        inner = v.get("Variable")
        base = short(inner, produced, 24) if inner else "$" + str(v.get("VariableName", "?"))
    elif kind == "ExtensionInput":
        base = "$input"
    elif kind == "Ask":
        base = "$ask"
    elif kind == "Clipboard":
        base = "$clipboard"
    else:
        base = "$" + str(v.get("VariableName") or kind or "?")
    for a in v.get("Aggrandizements") or []:
        t = a.get("Type", "")
        if t == "WFDictionaryValueVariableAggrandizement":
            base += "[%s]" % a.get("DictionaryKey")
        elif t == "WFPropertyVariableAggrandizement":
            base += "." + str(a.get("PropertyName"))
        elif t == "WFCoercionVariableAggrandizement":
            base += " as " + str(a.get("CoercionItemClass", "")).replace("WF", "").replace("ContentItem", "")
    return base


def clip(s, limit):
    s = re.sub(r"\s+", " ", str(s)).strip()
    return s if len(s) <= limit else "%s… (%d chars)" % (s[:limit], len(s))


def sketch(doc, name=None):
    actions = doc.get("WFWorkflowActions", [])
    produced = {a["WFWorkflowActionParameters"]["UUID"]: i
                for i, a in enumerate(actions)
                if "UUID" in a.get("WFWorkflowActionParameters", {})}

    lines, depth = [], 0
    if name:
        lines.append("%s  (%d actions)" % (name, len(actions)))
    for i, a in enumerate(actions):
        ident = a.get("WFWorkflowActionIdentifier", "?")
        key = ident[len(PREFIX):] if ident.startswith(PREFIX) else ident
        p = a.get("WFWorkflowActionParameters", {})

        if key in FLOW:
            mode = p.get("WFControlFlowMode", 0)
            word = FLOW[key][min(mode, 2)]
            if mode in (1, 2):
                depth = max(0, depth - 1)
            arg = ""
            if mode == 0 or (mode == 1 and key == "choosefrommenu"):
                arg = flow_arg(key, p, produced)
            lines.append("%3d %s%s%s" % (i, "  " * depth, word, (" " + arg) if arg else ""))
            if mode in (0, 1):
                depth += 1
            continue

        word, param = VERB.get(key, (key if ident.startswith(PREFIX) else ident, None))
        arg = short(p.get(param), produced) if param and param in p else ""
        lines.append("%3d %s%s%s" % (i, "  " * depth, word, (" " + arg) if arg else ""))
    return "\n".join(lines)


def flow_arg(key, p, produced):
    if key == "choosefrommenu":
        return short(p.get("WFMenuPrompt") or p.get("WFMenuItemTitle") or "", produced)
    if key == "conditional":
        cond = p.get("WFConditions")
        if cond:
            v = cond.get("Value", cond)
            parts = [one_condition(t, produced)
                     for t in (v.get("WFActionParameterFilterTemplates") or [])]
            joiner = " or " if v.get("WFActionParameterFilterPrefix") == 0 else " and "
            return joiner.join(parts)
        return one_condition(p, produced)
    for k in ("WFRepeatCount", "WFInput"):
        if k in p:
            return short(p[k], produced, 30)
    return ""


# Settled 2026-08-13 against branch semantics across the corpus, after an
# earlier guess had 2 and 3 inverted and read a correct shortcut as buggy.
# The ordering test is what pins them: every `count [2] 1` in the library has a
# true branch that handles several items (combine, repeat each, choose from a
# list), so 2 is "greater than". 0 and 1 are its mirror, and 100/101 fall out of
# the self-demo prologue, which fires when there is NO input.
CONDITION = {0: "<", 1: "<=", 2: ">", 3: ">=", 4: "is", 5: "is not",
             8: "starts with", 9: "ends with", 99: "contains",
             999: "does not contain", 100: "has value", 101: "no value"}


def one_condition(p, produced):
    subject = short(p.get("WFInput"), produced, 30) if "WFInput" in p else ""
    op = CONDITION.get(p.get("WFCondition"), str(p.get("WFCondition", "")))
    # The operand lives under one of two keys depending on whether the
    # comparison is textual or numeric, and a numeric one is silently dropped
    # if only the string key is read.
    obj = ""
    for k in ("WFConditionalActionString", "WFNumberValue", "WFAnotherNumber", "WFMeasurement"):
        if p.get(k) is None:
            continue
        v = p[k]
        if k == "WFMeasurement":
            q = v.get("Value", v)
            obj = "%s %s" % (q.get("Magnitude", "?"), q.get("Unit", ""))
        else:
            obj = short(v, produced, 30)
        break
    return " ".join(x for x in (subject, op, obj) if x)


def load(paths):
    """Merge several dumps, **keeping the last copy of a duplicated name.**

    This matched `index-dump.py`'s first-wins rule until 2026-08-18, when both
    were wrong for the same reason: once dumps span dates, a duplicate is one
    shortcut at two points in its life. Fixing only the index would have been
    worse than fixing neither, because the two derivatives would then disagree
    silently: `index.json` saying Show-Html has 9 actions while its sketch,
    generated from the older copy, still showed 23. Pass dumps oldest first,
    which is what the documented `dumps/*.zip` glob already does.
    """
    out = {}
    for path in paths:
        if path.endswith(".zip"):
            z = zipfile.ZipFile(path)
            for info in z.infolist():
                if info.is_dir():
                    continue
                n = info.filename
                if not info.flag_bits & 0x800:
                    try:
                        n = n.encode("cp437").decode("utf-8")
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                out[n.rsplit(".", 1)[0]] = z.read(info)
        else:
            out[Path(path).stem] = Path(path).read_bytes()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="+", help=".wflow files, or dump zips with --name/--all")
    ap.add_argument("--name", help="one shortcut out of the dumps")
    ap.add_argument("--all", action="store_true", help="every shortcut, one after another")
    ap.add_argument("--dir", help="write one <Name>.txt per shortcut here, instead of stdout")
    args = ap.parse_args()

    found = load(args.path)
    if args.name:
        if args.name not in found:
            near = sorted(n for n in found if args.name.lower() in n.lower())
            raise SystemExit("no %r%s" % (args.name,
                                          "; did you mean: " + ", ".join(near[:8]) if near else ""))
        found = {args.name: found[args.name]}
    elif not args.all and len(found) > 1:
        raise SystemExit("%d shortcuts; give --name or --all" % len(found))

    # --dir exists because the split from --all's stream into sketches/ was
    # done by hand and recorded nowhere, which is why tools/freshness.py can
    # only report sketch coverage as an advisory count instead of gating it.
    # A step nobody wrote down is a step that drifts.
    out = Path(args.dir) if args.dir else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    wrote = failed = 0
    for i, (name, blob) in enumerate(sorted(found.items())):
        try:
            text = sketch(plistlib.loads(blob), name)
        except Exception as err:
            print("%s  UNREADABLE: %s" % (name, err), file=sys.stderr)
            failed += 1
            continue
        if out:
            # ":" for "/", the same substitution a device dump makes in an entry
            # name, so a sketch filename matches the name index.json carries.
            (out / (name.replace("/", ":") + ".txt")).write_text(text + "\n")
            wrote += 1
        else:
            if i:
                print()
            print(text)
    if out:
        print("wrote %d sketches to %s%s"
              % (wrote, out, ", %d unreadable" % failed if failed else ""), file=sys.stderr)


if __name__ == "__main__":
    main()
