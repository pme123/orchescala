// Beispieldaten: das Datenmodell (In) des MKK-Prozesses.
//
// Nachgebildet aus der echten Orchescala-Domain
// (valiant-mkk/01-domain/.../openMkk/v1) — bewusst OHNE `InConfig` und
// `InitIn`: das sind Implementations-Details und gehören nicht in die Spez.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Field, ProcessSpec, TypeDef } from '../src/types.ts';

const f = (name: string, type: string, extra: Partial<Field> = {}): Field =>
  ({ id: `f-${name}-${type}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), name, type, ...extra });

const types: TypeDef[] = [
  {
    id: 'in', name: 'In', kind: 'case', root: true, status: 'implemented',
    description: 'Eingabe des Prozesses: Mieterschaft, Vermieterschaft und Mietobjekt.',
    fields: [
      f('renter', 't-rentalparty', { description: 'Die Mieterschaft — Person(en) oder Firma.' }),
      f('landlord', 't-rentalparty', { description: 'Die Vermieterschaft.' }),
      f('rentalObject', 't-rentalobject', { description: 'Das Mietobjekt mit Kautionsbetrag.' }),
      f('processCallOrigin', 'e-origin', { description: 'Aus welchem System der Prozess gestartet wurde.' }),
      f('invoiceToRenter', 'Boolean', {
        description: 'Flag to indicate whom to send the invoice to. If false, the invoice is sent to the landlord.',
      }),
    ],
  },
  {
    id: 't-rentalobject', name: 'RentalObject', kind: 'case', status: 'implemented',
    description: 'Das Mietobjekt und die Konditionen der Kaution.',
    fields: [
      f('address', 't-address'),
      f('rentStart', 'LocalDate', { optional: true, description: 'Start of the renting.' }),
      f('amountRentalDeposit', 'BigDecimal', { example: 'BigDecimal("4500.00")', description: 'Kautionsbetrag.' }),
      f('totalAmount', 'BigDecimal', { example: 'BigDecimal("4530.00")' }),
      f('rateCount', 'Int', { optional: true, example: '3' }),
      f('setupFee', 'BigDecimal', { optional: true, example: 'BigDecimal("30.00")' }),
    ],
  },
  {
    id: 't-address', name: 'InAddress', kind: 'case', status: 'implemented',
    fields: [
      f('street', 'String', { example: '"Musterstrasse"' }),
      f('houseNumber', 'String', { optional: true, example: '"12"' }),
      f('poBoxNo', 'String', { optional: true, description: "Text for number, eg. '1856900' or '23f'", example: '"123456"' }),
      f('postcode', 'String', { example: '"3000"' }),
      f('place', 'String', { example: '"Bern"' }),
      f('countryKey', 'String', { default: '"CH"', example: '"CH"' }),
      f('phone', 'String', { optional: true, example: '"+41793333333"' }),
      f('email', 'String', { optional: true, constraint: 'ValidEmail', example: '"default@email.com"' }),
    ],
  },
  {
    id: 't-rentalparty', name: 'InRentalParty', kind: 'case', status: 'implemented',
    description: 'Eine Partei des Mietverhältnisses — Person(en) oder Firma.',
    fields: [
      f('clientMainType', 'e-clienttype'),
      f('clientLanguage', 'e-lang', { description: 'Required by NNK: de | fr' }),
      f('nogaCode25', 'String', { optional: true, description: 'Possible values: `970000`. Default is `970000`.', example: '"970000"' }),
      f('selfEmployed', 'Boolean', { optional: true, description: 'Used to create Lead' }),
      f('legalStatusCode', 'Int', { optional: true, example: '36' }),
      f('domicileAddress', 't-address'),
      f('persons', 't-person', { optional: true, collection: true }),
      f('company', 't-company', { optional: true }),
      f('iban', 'Iban', { optional: true, description: 'Bestehendes Konto, falls vorhanden.' }),
      f('bankStatementRequired', 'Boolean', { optional: true, description: 'Nur Vermieterschaft.' }),
      f('editClientNumber', 'String', { optional: true, description: 'Optional possible to provide the client number' }),
      f('greaterIncome', 'Boolean', { optional: true, description: '_true_ if the renter earns more than 100k - used to create Lead' }),
    ],
  },
  {
    id: 't-person', name: 'InPerson', kind: 'case', status: 'implemented',
    fields: [
      f('formOfAddress', 'Int', { optional: true, description: 'Form of address of the person - x-codetable: formOfAddress', example: '2' }),
      f('firstName', 'String', { optional: true, description: 'First name.', example: '"Daniel"' }),
      f('name', 'String', { description: 'Last name.', example: '"Arnold"' }),
      f('dateOfBirth', 'LocalDate', { optional: true, description: 'Date of birth of the client (only loaded if the date incl. month and day is known)' }),
      f('nationality', 'String', { optional: true, constraint: 'FixedLength[2]', description: 'codesISO_3166-1 - Country code of the nationality', example: '"CH"' }),
    ],
  },
  {
    id: 't-company', name: 'InCompany', kind: 'case', status: 'implemented',
    fields: [
      f('name', 'String', { example: '"Muster AG"' }),
      f('uidNo', 'String', { optional: true, description: 'UID (Unternehmens-Identifikationsnummer), required for companies', example: '"CHE-123.456.789"' }),
      f('nationality', 'String', { optional: true, constraint: 'FixedLength[2]', example: '"CH"' }),
    ],
  },
  {
    id: 'e-clienttype', name: 'ClientType', kind: 'enum', status: 'implemented',
    description: 'Art der Kundenbeziehung.',
    values: [
      { name: 'privateIndividual', description: 'Einzelperson' },
      { name: 'severalPrivateIndividuals', description: 'Mehrere Privatpersonen' },
      { name: 'companiesAndOther', description: 'Firma oder andere' },
    ],
  },
  {
    id: 'e-lang', name: 'ClientLanguage', kind: 'enum', status: 'implemented',
    values: [{ name: 'de' }, { name: 'fr' }],
  },
  {
    id: 'e-origin', name: 'ProcessCallOrigin', kind: 'enum', status: 'implemented',
    description: 'Aufrufendes System.',
    values: [{ name: 'VPORTAL' }, { name: 'MAP' }, { name: 'CAMMobile' }, { name: 'CAMWeb' }, { name: 'VAPP' }],
  },
];

const path = process.argv[2] ?? 'sample-data/processes/valiant-mkk-openmkkv1.json';
const spec = JSON.parse(readFileSync(path, 'utf8')) as ProcessSpec;
spec.types = types;
writeFileSync(path, JSON.stringify(spec, null, 2));
console.log(`${path}: ${types.length} Typen gesetzt`);
