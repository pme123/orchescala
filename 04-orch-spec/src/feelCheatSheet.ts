// FEEL-Spickzettel für Camunda 8 — Inhalt für den Dialog in der Kopfzeile.
//
// Jedes Beispiel ohne führendes `=` (das gehört ins Feld, nicht zum Ausdruck).
// `check: false` = Ausdruck ist ohne passenden Kontext nicht auswertbar
// (Engine-Variablen, freie Namen). Alle anderen prüft `tools/`-Test bzw. die
// Kontrolle in der Entwicklung mit `feelin` — was hier steht, muss laufen.

export interface CheatRow {
  code: string;
  note: string;
  /** false = nicht ohne Kontext auswertbar */
  check?: boolean;
}

export interface CheatSection {
  title: string;
  intro?: string;
  rows: CheatRow[];
  /** Hinweis in Kästchen unter der Tabelle */
  warn?: string;
}

const r = (code: string, note: string, check = true): CheatRow => ({ code, note, check });

export const CHEAT_SECTIONS: CheatSection[] = [
  {
    title: 'Grundlagen',
    rows: [
      r('amount * 1.1', 'In BPMN-Feldern beginnt ein Ausdruck mit «=»; ohne «=» ist es fester Text', false),
      r('"text"', 'Zeichenkette: nur doppelte Anführungszeichen'),
      r('// Zeile   /* Block */\n1 + 1', 'Kommentare'),
      r('null', 'kein Wert'),
      r('order.customer.name', 'Pfad in verschachtelten Objekten', false),
      r('items[1]', 'Listen zählen ab **1**; `items[-1]` ist das letzte Element', false),
      r('`my-var` + 1', 'Namen mit Sonderzeichen in Backticks', false),
    ],
  },
  {
    title: 'Literale',
    rows: [
      r('[42, 3.14, -5, true, "abc"]', 'Zahl, Wahrheitswert, Text in einer Liste'),
      r('{a: 1, b: "x"}', 'Objekt (Context / Map)'),
      r('date("2026-09-29")', 'Datum'),
      r('time("14:30:00")', 'Zeit'),
      r('date and time("2026-09-29T14:30:00+02:00")', 'Datum mit Zeit'),
      r('duration("P1DT2H")', 'Dauer: Tage/Stunden'),
      r('duration("P1Y2M")', 'Dauer: Jahre/Monate'),
      r('@"2026-09-29"', 'Kurzform für ein Datum'),
    ],
  },
  {
    title: 'Operatoren',
    rows: [
      r('2 + 3 * 4 - 1 / 2', 'Arithmetik `+ - * /`'),
      r('2 ** 3', 'Potenz'),
      r('1 = 1', 'Vergleich — «=» ist hier kein Zuweisen'),
      r('1 != 2', 'ungleich; weiter `< <= > >=`'),
      r('true and not(false) or false', 'Logik: `and`, `or`, `not(…)` — nicht `&&`, `||`, `!`'),
      r('5 between 1 and 10', 'Bereich, Grenzen inklusive'),
      r('5 in (1..10)', 'Intervall: `(` `)` schliessen die Grenze aus, `[` `]` schliessen sie ein — `[1..10)`'),
      r('5 in (< 3, > 4)', 'mehrere Bedingungen (Unary Tests)'),
      r('5 in [1, 2, 5]', 'Wert in Liste'),
    ],
  },
  {
    title: 'Kontrollfluss',
    rows: [
      r('if 5 > 3 then "hoch" else "tief"', 'Bedingung — `else` ist Pflicht'),
      r('for i in 1..3 return i * 2', 'ergibt `[2, 4, 6]`'),
      r('for x in [{p: 2, q: 3}] return x.p * x.q', 'Schleife über Objekte'),
      r('some x in [1, 2, 3] satisfies x > 2', 'mindestens ein Element erfüllt es'),
      r('every x in [1, 2, 3] satisfies x > 0', 'alle Elemente erfüllen es'),
    ],
  },
  {
    title: 'Null & Absicherung',
    rows: [
      r('if x = null then "n/a" else x', 'auf null prüfen', false),
      r('is defined(x)', 'gibt es die Variable? Verhindert den Incident «no variable found»', false),
      r('get or else(x, "default")', 'Wert, sonst Vorgabe (bei null)', false),
      r('if is defined(x) and x != null then x else "default"', 'sicheres Muster für optionale Werte', false),
    ],
    warn: 'Eine nicht definierte Variable erzeugt in Zeebe einen **Incident** («no variable found for name …»). Vorher mit `is defined(x)` prüfen oder `get or else` nutzen.',
  },
  {
    title: 'Listen',
    rows: [
      r('[1, 2, 3][item > 1]', 'Filter — `item` ist das aktuelle Element'),
      r('[{id: 1, ok: true}, {id: 2, ok: false}][ok = true]', 'Filter auf Objekten: Felder direkt ansprechen (oder `item.ok`)'),
      r('[{name: "a"}, {name: "b"}].name', 'Projektion: Liste aller `name`'),
      r('[{id: 5, n: "x"}][id = 5][1]', 'ersten Treffer holen'),
      r('for i in [{id: 1, ok: true}, {id: 2, ok: false}][ok = true] return i.id', 'filtern und abbilden: erst filtern (`[ok = true]`), dann `for`'),
      r('count([1, 2]) + sum([1, 2]) + min([1, 2]) + max([1, 2]) + mean([1, 2])', 'Kennzahlen'),
      r('append([1], 2)', 'Element anhängen'),
      r('concatenate([1], [2])', 'Listen verbinden'),
      r('sort([3, 1, 2], function(a, b) a < b)', 'sortieren'),
      r('distinct values([1, 1, 2])', 'ohne Doppelte'),
      r('flatten([[1, 2], [3]])', 'Listen glätten'),
      r('index of([5, 6], 6)', 'Position(en) eines Elements'),
      r('list contains([1, 2], 2)', 'enthalten?'),
      r('sublist([1, 2, 3, 4], 2, 3)', 'Teilliste ab Position 2, Länge 3'),
      r('reverse([1, 2])', 'umkehren'),
      r('union([1], [1, 2])', 'Vereinigung'),
      r('string join(["a", "b"], ", ")', 'Liste zu Text'),
    ],
  },
  {
    title: 'Text',
    rows: [
      r('"Hallo " + "Welt"', 'Verketten mit +'),
      r('string length("abc")', 'Länge'),
      r('substring("abcdef", 2, 3)', 'Teiltext ab Position 2 (ab 1), Länge 3'),
      r('upper case("a") + lower case("B")', 'Gross-/Kleinschreibung'),
      r('contains("abc", "b")', 'enthält'),
      r('starts with("abc", "a") and ends with("abc", "c")', 'Anfang / Ende'),
      r('matches("AB12", "^[A-Z]{2}\\\\d+$")', 'Regex — Backslash doppelt schreiben'),
      r('replace("abc", "a", "b")', 'ersetzen (Regex)'),
      r('split("a,b", ",")', 'teilen'),
      r('substring before("a-b", "-") + substring after("a-b", "-")', 'vor / nach einem Trenner'),
      r('trim("  a ")', 'Leerzeichen am Rand entfernen'),
    ],
  },
  {
    title: 'Zahlen',
    rows: [
      r('abs(-3) + floor(2.7) + ceiling(2.1)', 'Betrag, abrunden, aufrunden'),
      r('round half up(2.345, 2)', 'kaufmännisch runden'),
      r('round half down(2.345, 2)', '0.5 nach unten'),
      r('modulo(10, 3) + sqrt(16)', 'Rest, Wurzel'),
      r('odd(3) and even(4)', 'ungerade / gerade'),
      r('number("42")', 'Text → Zahl'),
      r('string(42)', 'Zahl → Text'),
      r('10 / 4', '= 2.5 — Zahlen sind Dezimalzahlen'),
    ],
  },
  {
    title: 'Datum & Zeit',
    rows: [
      r('now()', 'jetzt (Datum mit Zeit)'),
      r('today()', 'heute'),
      r('date("2026-09-29") + duration("P7D")', 'Datum plus Dauer'),
      r('date(2026, 9, 29)', 'Datum aus Teilen'),
      r('date("2026-09-29").year', 'Teile: `.year` `.month` `.day` `.weekday`'),
      r('date and time(date("2026-09-29"), time("10:00:00"))', 'Datum + Zeit zusammensetzen'),
      r('date("2026-09-29") - date("2026-01-01")', 'Differenz als Dauer'),
      r('years and months duration(date("2026-01-01"), date("2026-09-29"))', 'Jahre und Monate dazwischen'),
      r('now() + duration("PT1H")', 'Beispiel für einen Timer'),
    ],
    warn: 'ISO-8601-Dauern für Timer-Events: `PT5M`, `PT1H`, `P1D`, `P1DT12H`; `R3/PT10S` = 3 Wiederholungen alle 10 s. Ein Timer kann auch ein FEEL-Ausdruck sein.',
  },
  {
    title: 'Objekte',
    rows: [
      r('{a: 1, b: 2}.a', 'Zugriff'),
      r('context put({a: 1}, "b", 2)', 'Eintrag setzen'),
      r('context merge({a: 1}, {b: 2})', 'zusammenführen — das zweite überschreibt'),
      r('get entries({a: 1})', 'Liste von `{key, value}`'),
      r('get value({a: 1}, "a")', 'Wert zu einem Schlüssel'),
      r('{ total: sum([1, 2]), ts: string(now()) }', 'Objekt aufbauen'),
      r('from json("{\\"a\\": 1}")', 'JSON-Text → Objekt'),
      r('to json({a: 1})', 'Objekt → JSON-Text'),
    ],
  },
  {
    title: 'Typen',
    rows: [
      r('1 instance of number', 'prüfen: `number`, `string`, `boolean`, `list`, `context`, `date` …'),
      r('string(42) + string(true)', 'in Text wandeln'),
      r('number("42") + 1', 'in Zahl wandeln'),
    ],
  },
  {
    title: 'Multi-Instance',
    intro: 'Innerhalb einer Mehrfachausführung kennt der Schritt zusätzlich:',
    rows: [
      r('loopCounter', 'Nummer des Durchlaufs, ab 1', false),
      r('line.price', 'das Element der Sammlung — so heisst es, wie im Modeler als «Input element» eingetragen', false),
      r('sum(results)', 'Output-Aggregation, z. B. am Output element', false),
    ],
  },
  {
    title: 'Typische Stellen im BPMN',
    rows: [
      r('amount > 1000 and status = "OPEN"', 'Sequence-Flow-Bedingung (muss ein Wahrheitswert sein)', false),
      r('order.customer.id', 'Input-Mapping: Ziel `customerId`, Quelle so', false),
      r('response.body.data', 'Output-Mapping: Ziel `result`, Quelle so', false),
      r('"sub-" + type', 'Call Activity: Prozess-ID', false),
      r('orderId', 'Message: Correlation Key', false),
      r('"PT" + string(minutes) + "M"', 'Timer-Dauer', false),
      r('"ERR_" + type', 'Error-/Escalation-Code', false),
    ],
  },
  {
    title: 'Fallstricke',
    rows: [],
    warn: [
      '«=» ist der **Vergleich**; eine Zuweisung gibt es in FEEL nicht.',
      'Listen zählen ab **1**; `items[0]` ist immer null.',
      'Ein Vergleich mit `<`, `>` gegen null ergibt null (nicht false); ein Sequence Flow mit null-Bedingung wird nicht genommen. `x = null` selbst liefert wahr oder falsch.',
      'Typfehler (`"a" + 1`) ergeben null, keinen Fehler — die Prüfung in der App meldet sie.',
      'Kein `&&`, `||`, `==`, `!` — es heisst `and`, `or`, `=`, `not(…)`.',
      'Zahlen kommen aus Job-Workern oft als **Text** — dann `number()`, `date()`, `date and time()`.',
      'Im Filter einer Liste ist das Element `item` (oder man schreibt das Feld direkt: `items[active = true]`); eine Schleifenvariable gilt dort noch nicht.',
      'Leerzeichen in Funktionsnamen sind erlaubt (`upper case(s)`).',
    ].join('\n'),
  },
];

/** Camunda 7 (JUEL) → Camunda 8 (FEEL) */
export const JUEL_TO_FEEL: [juel: string, feel: string][] = [
  ['${amount > 100}', '= amount > 100'],
  ['${a && b}', '= a and b'],
  ['${!x}', '= not(x)'],
  ['${a == "x"}', '= a = "x"'],
  ['${list.size()}', '= count(list)'],
  ['${execution.getVariable("x")}', '= x'],
  ['${empty list}', '= list = null or count(list) = 0'],
  ['${x != null ? x : "d"}', '= if x != null then x else "d"'],
  ['${str.contains("a")}', '= contains(str, "a")'],
];
