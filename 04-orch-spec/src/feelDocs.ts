// Katalog der FEEL-Funktionen und -Schlüsselwörter für die Vervollständigung.
//
// Jeder Eintrag hat eine kurze Erklärung und ein Beispiel — sie erscheinen
// unter der Vorschlagsliste. Grundlage: die Funktionsliste von Camunda 8
// (Built-in functions). Leerzeichen im Namen sind in FEEL erlaubt.

export type FeelDocKind = 'function' | 'keyword';

export interface FeelDoc {
  name: string;
  kind: FeelDocKind;
  category: string;
  /** Aufruf mit Parametern, z. B. `substring(text, start, länge?)` */
  signature: string;
  description: string;
  example?: string;
  /** Text, der eingesetzt wird; bei Funktionen mit Klammern, der Cursor steht dazwischen */
  insert: string;
  /** Anzahl Zeichen, die der Cursor nach dem Einsetzen zurückspringt */
  back: number;
}

type Row = [name: string, params: string | null, description: string, example?: string];

const fn = (category: string, rows: Row[]): FeelDoc[] => rows.map(([name, params, description, example]) => ({
  name, kind: 'function', category,
  signature: `${name}(${params ?? ''})`,
  description, ...(example ? { example } : {}),
  insert: `${name}()`, back: params === '' ? 0 : 1,
}));

const kw = (rows: [name: string, description: string, example: string, insert?: string][]): FeelDoc[] =>
  rows.map(([name, description, example, insert]) => ({
    name, kind: 'keyword', category: 'Schlüsselwort', signature: name, description, example, insert: insert ?? name, back: 0,
  }));

export const FEEL_DOCS: FeelDoc[] = [
  ...kw([
    ['if', 'Bedingung: `if … then … else …`. Der else-Zweig ist Pflicht.', 'if amount > 100 then "hoch" else "tief"', 'if  then  else '],
    ['then', 'Ergebnis, wenn die Bedingung gilt.', 'if x > 1 then "a" else "b"'],
    ['else', 'Ergebnis, wenn die Bedingung nicht gilt.', 'if x > 1 then "a" else "b"'],
    ['for', 'Schleife über eine Liste oder einen Bereich; ergibt eine Liste.', 'for i in items return i.price * i.qty', 'for  in  return '],
    ['return', 'Ausdruck, der je Durchlauf von `for` berechnet wird.', 'for i in 1..3 return i * 2'],
    ['some', 'Wahr, wenn mindestens ein Element die Bedingung erfüllt.', 'some x in items satisfies x.price > 100', 'some  in  satisfies '],
    ['every', 'Wahr, wenn alle Elemente die Bedingung erfüllen.', 'every x in items satisfies x.qty > 0', 'every  in  satisfies '],
    ['satisfies', 'Bedingung für `some` / `every`.', 'some x in items satisfies x.ok'],
    ['in', 'Element in Liste oder Bereich; auch in `for`/`some`/`every`.', 'x in [1, 2, 3]   x in (1..10)   x in (< 5, > 20)'],
    ['between', 'Wert liegt zwischen zwei Grenzen (inklusive).', 'x between 1 and 10', 'between  and '],
    ['and', 'Logisches Und. Es gibt kein `&&`.', 'a > 1 and b < 2'],
    ['or', 'Logisches Oder. Es gibt kein `||`.', 'a > 1 or b < 2'],
    ['instance of', 'Prüft den Typ eines Werts.', 'x instance of number   (string, boolean, list, context, date …)'],
    ['function', 'Eigene Funktion, z. B. als Vergleich für `sort`.', 'sort(items, function(a, b) a < b)', 'function() '],
    ['null', 'Kein Wert. Vergleiche mit null ergeben `null`, nicht `false`.', 'if x = null then "n/a" else x'],
    ['true', 'Wahrheitswert wahr.', 'active = true'],
    ['false', 'Wahrheitswert falsch.', 'active = false'],
  ]),
  ...fn('Null & Typ', [
    ['is defined', 'wert', 'Ist die Variable bzw. der Pfad vorhanden? Verhindert den Incident «no variable found». `null` zählt als vorhanden.', 'is defined(order.note)'],
    ['get or else', 'wert, vorgabe', 'Der Wert, oder die Vorgabe, wenn er `null` ist.', 'get or else(order.note, "kein Hinweis")'],
    ['not', 'bedingung', 'Kehrt einen Wahrheitswert um. Es gibt kein `!`.', 'not(x = 1)'],
    ['string', 'wert', 'Wert als Text.', 'string(42)  →  "42"'],
    ['number', 'text', 'Text als Zahl.', 'number("42")  →  42'],
  ]),
  ...fn('Liste', [
    ['count', 'liste', 'Anzahl der Elemente.', 'count(items)'],
    ['sum', 'liste', 'Summe der Zahlen.', 'sum(items.price)'],
    ['min', 'liste', 'Kleinster Wert.', 'min(items.price)'],
    ['max', 'liste', 'Grösster Wert.', 'max(items.price)'],
    ['mean', 'liste', 'Durchschnitt.', 'mean(items.price)'],
    ['median', 'liste', 'Median.', 'median([1, 2, 9])'],
    ['product', 'liste', 'Produkt der Zahlen.', 'product([2, 3])  →  6'],
    ['all', 'liste', 'Wahr, wenn alle Elemente wahr sind.', 'all(items.ok)'],
    ['any', 'liste', 'Wahr, wenn mindestens ein Element wahr ist.', 'any(items.ok)'],
    ['append', 'liste, element', 'Liste mit einem zusätzlichen Element am Ende.', 'append(items, newItem)'],
    ['concatenate', 'liste1, liste2', 'Listen hintereinander hängen.', 'concatenate(a, b)'],
    ['distinct values', 'liste', 'Liste ohne doppelte Werte.', 'distinct values([1, 1, 2])  →  [1, 2]'],
    ['flatten', 'liste', 'Verschachtelte Listen zu einer.', 'flatten([[1, 2], [3]])  →  [1, 2, 3]'],
    ['index of', 'liste, element', 'Positionen (ab 1), an denen das Element steht.', 'index of(items, x)'],
    ['list contains', 'liste, element', 'Ist das Element in der Liste?', 'list contains(items, x)'],
    ['insert before', 'liste, position, element', 'Element vor eine Position einfügen (Position ab 1).', 'insert before(items, 1, x)'],
    ['remove', 'liste, position', 'Element an einer Position entfernen (ab 1).', 'remove(items, 1)'],
    ['reverse', 'liste', 'Liste umgekehrt.', 'reverse(items)'],
    ['sort', 'liste, vergleich', 'Sortiert mit einer Vergleichsfunktion.', 'sort(items, function(a, b) a < b)'],
    ['sublist', 'liste, start, länge?', 'Teilliste ab einer Position (ab 1).', 'sublist(items, 2, 3)'],
    ['union', 'liste1, liste2', 'Vereinigung ohne Doppelte.', 'union(a, b)'],
    ['list replace', 'liste, position, element', 'Element an einer Position ersetzen.', 'list replace(items, 1, x)'],
    ['split', 'text, trenner', 'Text an einem Trenner (Regex) in eine Liste teilen.', 'split("a,b", ",")  →  ["a", "b"]'],
    ['string join', 'liste, trenner?', 'Liste von Texten zu einem Text.', 'string join(items.name, ", ")'],
  ]),
  ...fn('Text', [
    ['string length', 'text', 'Anzahl Zeichen.', 'string length("abc")  →  3'],
    ['substring', 'text, start, länge?', 'Teiltext ab einer Position (ab 1).', 'substring("abcdef", 2, 3)  →  "bcd"'],
    ['substring before', 'text, suche', 'Text vor dem ersten Vorkommen.', 'substring before("a-b", "-")  →  "a"'],
    ['substring after', 'text, suche', 'Text nach dem ersten Vorkommen.', 'substring after("a-b", "-")  →  "b"'],
    ['upper case', 'text', 'Grossbuchstaben.', 'upper case("abc")  →  "ABC"'],
    ['lower case', 'text', 'Kleinbuchstaben.', 'lower case("ABC")  →  "abc"'],
    ['contains', 'text, teil', 'Enthält der Text den Teil?', 'contains("abc", "b")'],
    ['starts with', 'text, anfang', 'Beginnt der Text so?', 'starts with(s, "CH")'],
    ['ends with', 'text, ende', 'Endet der Text so?', 'ends with(s, ".pdf")'],
    ['matches', 'text, muster', 'Passt der Text auf einen regulären Ausdruck? Backslash doppelt schreiben.', 'matches(s, "^[A-Z]{2}\\\\d+$")'],
    ['replace', 'text, muster, ersatz', 'Ersetzt Treffer (regulärer Ausdruck).', 'replace(s, "a", "b")'],
    ['trim', 'text', 'Entfernt Leerzeichen am Anfang und Ende.', 'trim("  a ")  →  "a"'],
    ['from json', 'text', 'JSON-Text als Objekt bzw. Liste.', 'from json(jsonString)'],
    ['to json', 'wert', 'Wert als JSON-Text.', 'to json(order)'],
  ]),
  ...fn('Zahl', [
    ['abs', 'zahl', 'Betrag.', 'abs(-5)  →  5'],
    ['floor', 'zahl', 'Abrunden.', 'floor(2.7)  →  2'],
    ['ceiling', 'zahl', 'Aufrunden.', 'ceiling(2.1)  →  3'],
    ['round half up', 'zahl, stellen?', 'Runden, 0.5 nach oben.', 'round half up(2.345, 2)  →  2.35'],
    ['round half down', 'zahl, stellen?', 'Runden, 0.5 nach unten.', 'round half down(2.345, 2)  →  2.34'],
    ['round up', 'zahl, stellen?', 'Weg von Null runden.', 'round up(2.341, 2)  →  2.35'],
    ['round down', 'zahl, stellen?', 'Gegen Null runden.', 'round down(2.349, 2)  →  2.34'],
    ['modulo', 'zahl, teiler', 'Rest der Division.', 'modulo(10, 3)  →  1'],
    ['sqrt', 'zahl', 'Quadratwurzel.', 'sqrt(16)  →  4'],
    ['log', 'zahl', 'Natürlicher Logarithmus.', 'log(10)'],
    ['exp', 'zahl', 'e hoch Zahl.', 'exp(1)'],
    ['odd', 'zahl', 'Ist die Zahl ungerade?', 'odd(3)'],
    ['even', 'zahl', 'Ist die Zahl gerade?', 'even(4)'],
  ]),
  ...fn('Datum & Zeit', [
    ['now', '', 'Aktuelles Datum mit Zeit.', 'now() + duration("PT1H")'],
    ['today', '', 'Heutiges Datum.', 'today()'],
    ['date', 'text | jahr, monat, tag', 'Datum aus Text oder Teilen.', 'date("2026-09-29")   date(2026, 9, 29)'],
    ['time', 'text', 'Zeit aus Text.', 'time("14:30:00")'],
    ['date and time', 'text | datum, zeit', 'Datum mit Zeit aus Text oder aus Datum + Zeit.', 'date and time("2026-09-29T14:30:00+02:00")'],
    ['duration', 'text', 'Dauer im ISO-8601-Format (Tage/Stunden bzw. Jahre/Monate).', 'duration("P1DT2H")   duration("PT30M")'],
    ['years and months duration', 'von, bis', 'Dauer in Jahren und Monaten zwischen zwei Daten.', 'years and months duration(d1, d2)'],
    ['day of week', 'datum', 'Wochentag als Text.', 'day of week(today())'],
    ['day of year', 'datum', 'Tag im Jahr (1–366).', 'day of year(today())'],
    ['week of year', 'datum', 'Kalenderwoche.', 'week of year(today())'],
    ['month of year', 'datum', 'Monat als Text.', 'month of year(today())'],
  ]),
  ...fn('Objekt', [
    ['context put', 'objekt, schlüssel, wert', 'Objekt mit einem gesetzten oder ergänzten Eintrag.', 'context put(ctx, "key", value)'],
    ['context merge', 'objekt1, objekt2', 'Objekte zusammenführen; das zweite überschreibt.', 'context merge(a, b)'],
    ['context', 'einträge', 'Objekt aus einer Liste von `{key, value}`.', 'context([{key: "a", value: 1}])'],
    ['get entries', 'objekt', 'Liste von `{key, value}` aller Einträge.', 'get entries(ctx)'],
    ['get value', 'objekt, schlüssel', 'Wert zu einem Schlüssel.', 'get value(ctx, "key")'],
  ]),
];

const byName = new Map(FEEL_DOCS.map(d => [d.name, d]));
export const feelDoc = (name: string): FeelDoc | undefined => byName.get(name);
