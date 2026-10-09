# Changelog

All notable changes to this project will be documented in this file.

* Types of Changes (L3):
  * Added: new features
  * Changed: changes in existing functionality
  * Deprecated: soon-to-be-removed features
  * Removed: now removed features
  * Fixed: any bug fixes
  * Security: in case of vulnerabilities


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## 0.8.3 - 2026-10-09
### Changed 
- Merge pull request #37 from pme123/feature/orch-theme-transparent-logo - see [Commit](https://github.com/pme123/orchescala/commit/a9a16340bf3eebc6ea879be45e90da7f1aed08fe)
- Orch theme skill: a PNG logo on a white box becomes transparent - see [Commit](https://github.com/pme123/orchescala/commit/abc150548c330470b99586bc47a833819c9cae6c)
- Orch Spec pages: no let in the theme code (#36) - see [Commit](https://github.com/pme123/orchescala/commit/60b2851d5d62abd17f1f783ce6c6204e0c24e403)
- Docs: projects in a company's single repo (tags per project); gateway serves released APIs (#35) - see [Commit](https://github.com/pme123/orchescala/commit/db2e42e8b4c0a6bc407f380e14713a3b0d7eb8ea)
- Orch Spec pages: a friendlier designer, data view, app theme - and a skill for the bank's look (#34) - see [Commit](https://github.com/pme123/orchescala/commit/6a8116db54b905bdcc6df333ab1f04f863fb4531)
- Publish: build everything locally before the upload; docker images for linux/amd64 (#33) - see [Commit](https://github.com/pme123/orchescala/commit/714a7ff4ea81f23910f28f60c803ce094825a58e)
- Orch Spec: the c7 engine is «Camunda 7 / Operaton» (#32) - see [Commit](https://github.com/pme123/orchescala/commit/2f215770b5c0b8c0b979c7a15d16799be23e0f91)
- Orch Spec: an embedded subprocess gets its own icon (SquarePlus, the [+] marker of BPMN), an event subprocess a dashed one - a call activity keeps Boxes - see [Commit](https://github.com/pme123/orchescala/commit/aa5885f3e38c1b2cab83c32cf290f7ea53befb4b)
- Orch Spec: export knows the element of a multi-instance (inputs, outputs, conditions - boolValue() & Co.); an optional field on a Spin path is checked first (hasProp/isNull) - prop() throws otherwise; a sync keeps unchecked rows and the status when the diagram has exactly the active rows of the spec (missing or stale base no longer flips accepted services to changed) - see [Commit](https://github.com/pme123/orchescala/commit/3a04f7563830db5323ec886bc884d45965be46ee)
- Orch Spec: a step without label in the BPMN (named like its id, e.g. Activity_04tlno2) gets a warning; a name set in the spec stays on merge and the export writes it into the BPMN as label (not for start, end and gateways) - see [Commit](https://github.com/pme123/orchescala/commit/d162a21088267dcf2013c2e153deb242838ff00d)
- Orch Spec: a step's status applies to its data model (interaction with In/Out; at the start the process' classes), and the start shows the process' classes when they are behind; a status of an interaction or its In/Out applies to all three; a wiring step (pattern block, the process' own message) gets no «no interaction» warning - see [Commit](https://github.com/pme123/orchescala/commit/9847e10be7cc45605796b032d939eb7c9edd8076)
- Worker: a topic registered twice is subscribed once (with a warning) - a second C7 subscription failed and stopped all workers; Orch Spec export: a worker already registered in the WorkerApp (block of another name) is not added again - see [Commit](https://github.com/pme123/orchescala/commit/d261ab77b5734a2c1c60b174e2eff1dfeb536d04)
- Orch Spec: the pages of an app - designer with live preview, renderer as app bundle (E15) (#31) - see [Commit](https://github.com/pme123/orchescala/commit/b7de6fb12d7c662ee6fbbfa9b9f6ea4aa4305de2)
- Orch Spec: a step in a pattern block and the process' own start message get no interaction (old drafts go); a step carries the status of its interaction in filter and chip; the whole descr goes to the helper, which writes lazy val descr (stripMargin for several lines) - see [Commit](https://github.com/pme123/orchescala/commit/c116260e7e60192857c270dfae4efbd704c8b9a1)
- Orch Spec: override def descr of the process object is read (multi-line too) and fills an empty Beschrieb / Ausgangslage / Ziel on import and domain sync; field «Quelle» removed - see [Commit](https://github.com/pme123/orchescala/commit/04d8d4044f35558cd51ab4fb9fa5512da5faf234)
- Orch Spec export: the package clause is split after domain (package valiant.product.domain / package lilaSet.v2) - in the files of the app and a new process object of the helper; imports of the domain package itself are left out - see [Commit](https://github.com/pme123/orchescala/commit/eb97b45295baf90e8e3e3138f6ff5b09b1813155)
- Orch Spec: a mock that reads a general variable (_outputMock) gets no InConfig field of that name - the field comes from the step name, the BPMN reads it - see [Commit](https://github.com/pme123/orchescala/commit/6a8b275563cdf118b538c058780cd33ad480aa50)
- Orch Spec export: an existing override val / lazy val processLabels is kept (no second one); a new one is written as override lazy val - see [Commit](https://github.com/pme123/orchescala/commit/bb10f33c04a5402bd2e9250d2656c1b3c4378a49)
- Orch Spec: a boundary event chosen in the diagram shows the step it is attached to (its handled errors) instead of the process - see [Commit](https://github.com/pme123/orchescala/commit/e1b57ccb4476ab561fdc29ad1646778ce342ccfb)
- Orch Spec: a call activity shows its process (found by calledProcess) instead of «kein Service gewählt»; choosing the same service again keeps the rows its catalog does not know - see [Commit](https://github.com/pme123/orchescala/commit/262162b339a495741382a38ecd6c71162c88ea51)
- Orch Spec: a call gets no row inConfig - the caller's InConfig is not the callee's; an old unchecked row goes, a checked one is warned about; the fields of the In and its InConfig are known inputs - see [Commit](https://github.com/pme123/orchescala/commit/b4f169cdb559c0865da95f21244cb27af16ab829)
- Orch Spec: intValue() / longValue() / doubleValue() of Spin is the number itself in FEEL (was number(...), which reads text and has no JUEL counterpart); number(path) from an older import becomes the diagram's value on the next BPMN sync - see [Commit](https://github.com/pme123/orchescala/commit/3221ff69e882844700abc80aad4602b2a80156ef)
- Worker: CustomError.refused - a 4xx for refusals of custom workers over HTTP (#30) - see [Commit](https://github.com/pme123/orchescala/commit/dcb4d548a17b19fb88b64d05e183ed97775073c8)
- Orch Spec: the fields of the InConfig of a called process (postAccountMock) are known inputs - no «noch nicht im Katalog» - see [Commit](https://github.com/pme123/orchescala/commit/33898864b725efbba8631e1f3ead4256e4298a20)
- Orch Spec: routing fields of an In decoder (useCase or clientType) - one of them is required; with clientType the case is chosen at runtime; final val topicName is read; the generated catalog is supplemented with what the own scan knows newer - see [Commit](https://github.com/pme123/orchescala/commit/13924f2828228a2aca28d1af5a5e191cc664bcd1)
- Gateway: public access - calls without a Bearer token (/public/...) (#29) - see [Commit](https://github.com/pme123/orchescala/commit/4546f8fccad60899203375889c287b2b1ae32608)
- Orch Spec: Spin prop(name, value) in JUEL is context put(x, name, value) in FEEL - and back for Camunda 7 - see [Commit](https://github.com/pme123/orchescala/commit/d61e6001e2f1d4e91d7794540da874260533c630)
- Orch Spec: a topicName (processName, key) on the next line (val topicName: String = ⏎ "…", wrapped by scalafmt) is read by the domain scan; the worker is found on import, its In/Out with the real types instead of a draft of Strings - see [Commit](https://github.com/pme123/orchescala/commit/5ff930206a74aa08be64618d920489ef7ac8a9d5)
- Orch Spec: status order with Angepasst after Final; the status of a specification is the smallest status of its parts (steps, data model) - derived, no longer set - see [Commit](https://github.com/pme123/orchescala/commit/b4e07d49a3a1dfab12b518c7316b507b3f2f745b)
- Orch Spec: JSON('[6026, 102]') / S('…') is a FEEL list or context on import, a list or context of constants is JSON('…') in JUEL; rows stored as JSON text become the list on the next BPMN sync - see [Commit](https://github.com/pme123/orchescala/commit/32596b877e04e2bd209318bc78fae304c27a3324)
- Orch Spec: a new status of a step applies to everything below it (paths, sub process, error and side paths) - one audit entry - see [Commit](https://github.com/pme123/orchescala/commit/72d14eb7bdbf431c560ea9bc142147b3a9a53096)
- Orch Spec tree: when filtering, only paths with a match are shown; expand/collapse all reaches the pattern blocks too - see [Commit](https://github.com/pme123/orchescala/commit/c06067e98d20bfa0f53f2bbdee20006334d1a511)
- Orch Spec: the default of a fixed case (ProcessStatus.succeeded.type = ProcessStatus.succeeded) is the case itself - not imported, not reported as unused - see [Commit](https://github.com/pme123/orchescala/commit/aeb92725e38048274607941c920bb83472e2a8f5)

## 0.8.2 - 2026-10-06
### Changed 
- Orch Spec: alias choice for In/Out offers only the same member, and X.In / X.Out from the catalog via search (fields as a copy) - see [Commit](https://github.com/pme123/orchescala/commit/a0511726f38a57b04a2a78206e217ba420c02dcf)
- Orch Spec: In/Out of an interaction can be another type (type In = OrderCardUT.In) with deviating example values (In.example.copy(...)) - kept on import, written on export; texts with a Scala path in ${...} become s"..." - see [Commit](https://github.com/pme123/orchescala/commit/6647c7205ec0827d076ffec34b550aac8ba94988)
- Merge pull request #28 from pme123/fix/orchspec-register-commented-block - see [Commit](https://github.com/pme123/orchescala/commit/449103220f49f54b39eecfe7275c27add15327bc)
- processFromSpec: comments read as Scala does - see [Commit](https://github.com/pme123/orchescala/commit/409350447938e61dd705472250585db542f59989)
- processFromSpec: a block in a comment is no registration - see [Commit](https://github.com/pme123/orchescala/commit/74e6ade3b3d625531655604ca5947f8335abe091)
- Orch Spec: BPMN written without the modeler (patterns, export, engine conversion) follows the order of the BPMN schema - Camunda 7 rejected the deployment (ENGINE-09005) - see [Commit](https://github.com/pme123/orchescala/commit/2adadc35fac7e48a561204c1c1cab22473edc2ba)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](https://github.com/pme123/orchescala/commit/703fee3e2008b671b776052ac11f2b774243cac5)
- Orch Spec: pattern parameters inside a string are plain text with value choices (processStatus: the Orchescala statuses); ProcessStatus of Orchescala always in the type picker; a processStatus String in Out becomes the fixed case - see [Commit](https://github.com/pme123/orchescala/commit/2817b738f60551154e3f2712f7d0272e0aebf623)
- Merge pull request #27 from pme123/fix/orch-spec-decision-variables - see [Commit](https://github.com/pme123/orchescala/commit/d59406b9edabbed24d7fa7b5964d25af3edea0fe)
- Orch Spec patterns: shared blocks go to the bottom right of the diagram - see [Commit](https://github.com/pme123/orchescala/commit/928e98119806d99b008db909d385facf7487269c)
- Orch Spec patterns: an existing shared block gets what it lacks (the listener at the end); a variable set at an end event becomes a field of Out (processStatus as fixed ProcessStatus case); empty InitIn/InConfig are no error - see [Commit](https://github.com/pme123/orchescala/commit/4a381a4c4a02054f7226be079016bc8afdc96d09)
- Orch Spec: one rule for «reads its In directly», Camunda 8 output mappings, tests - see [Commit](https://github.com/pme123/orchescala/commit/36521a36d441f9b658007ad464991b7bb3c4b86b)
- Orch Spec: a DMN decision reads its In and writes its result without mapping - see [Commit](https://github.com/pme123/orchescala/commit/2baf4ddecf26a5fdc50a4a6a89586902a2ab90c6)
- Init worker: InitIn fields to implement are ??? instead of the example values - so it fails until it is done (customInit from Orch Spec and the processFromSpec fallback) - see [Commit](https://github.com/pme123/orchescala/commit/0a8f71314bd70a66294dc2008473707553234146)
- processFromSpec: the exported process object name counts only while its file exists - otherwise the name follows the process, without the version - see [Commit](https://github.com/pme123/orchescala/commit/a0200efbd41b15afbb31ae165b2249def6bd33fc)
- Orch Spec: only the DMN decision table view gets its own chunk - fixed chunks for DRD and shared parts made them depend on each other in a circle - see [Commit](https://github.com/pme123/orchescala/commit/a5240787384bca7dd21c63c13bc10c34cc715b26)
- Orch Spec: Spin paths end by field type also in output mappings (typed from the step's result) and for step outputs and class-typed variables; Spin paths written without ending are completed on export - see [Commit](https://github.com/pme123/orchescala/commit/917001bcabcff2760bc2b40cfe6253f7b50aa656)
- Orch Spec: restore the Epics changes of 837813c that e89bef7 reverted by mistake - see [Commit](https://github.com/pme123/orchescala/commit/377309b11f83c16d47e2f928a8f62bd3b8ad9efc)
- Orch Spec: FEEL paths become Spin for Camunda 7 (prop(...) with stringValue/numberValue/boolValue by field type, null checks via hasProp/isNull); stale ${a.b.c} texts in the diagram are rewritten on export - see [Commit](https://github.com/pme123/orchescala/commit/e89bef7dd5cdbb2be7fd90fa7adcaad2429f0132)
- Orch Spec: Epics — Prozesse 0..* Epics zuordnen, in der Übersicht danach filtern; anlegen nur Admin - see [Commit](https://github.com/pme123/orchescala/commit/837813cbc4e9d86ed647202453d9381f8724709c)
- Orch Spec: a step's domain In/Out comes from the package of its object, not from a same-named object of another project - see [Commit](https://github.com/pme123/orchescala/commit/ad3d9c8387ba0703625965636d126480ed6af297)
- Orch Spec: a pattern replaces same-named mappings on the element instead of adding them twice - see [Commit](https://github.com/pme123/orchescala/commit/633b8603bbb44212d19b98162b99e48fe52765c7)
- Merge pull request #26 from pme123/feature/project-engine-type - see [Commit](https://github.com/pme123/orchescala/commit/b5fd6eb0e1e999ff604b179a1974c01efdc5d5e6)
- engineType: error names the value and the file; tests for the engine choice - see [Commit](https://github.com/pme123/orchescala/commit/d8937c992e80fe31788e01bc2b5559f9bcab3a4d)
- Orch Spec: suggestions also right after a dot; a service without topicName finds its domain object via the derived package; no Camunda 7 hint for incomplete FEEL - see [Commit](https://github.com/pme123/orchescala/commit/cf366c049e68b0edca03447a02d1eca76c326aef)
- Merge remote-tracking branch 'origin/develop' into feature/project-engine-type - see [Commit](https://github.com/pme123/orchescala/commit/613193e911f8db562f02c5040dae963ae3662c2a)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](https://github.com/pme123/orchescala/commit/44d373498a0089388c6e58a7a8e60b8d26539e16)
- Orch Spec: FEEL fields expand while editing, suggestions only after a typed letter; JSON (list/context) becomes a Groovy script with Spin for Camunda 7 and reads back as FEEL; dmn-js split into chunks - see [Commit](https://github.com/pme123/orchescala/commit/e22358bb2860c2085d8a84d885396c5672c43ee0)
- Merge pull request #23 from pme123/feature/readme-testcontainers - see [Commit](https://github.com/pme123/orchescala/commit/c1359b3607927e5cfdb9258982fe413f23cb4b4e)
- Helper: engineType per project in PROJECT.conf - see [Commit](https://github.com/pme123/orchescala/commit/66036d818d09f4b36c3020488a1960630e57997a)
- Merge pull request #25 from pme123/feature/company-op-wrappers - see [Commit](https://github.com/pme123/orchescala/commit/b75ea73c65f5bf4a4f0127909d04307ebaf54a22)
- processFromSpec: a new field without default in InitIn/InConfig also goes into its example - with the value of the export - see [Commit](https://github.com/pme123/orchescala/commit/8da7af3764ec2f1d9c79e883e4ee6ccda298fa2e)
- Company generator: warn when the existing CompanyWorker misses an engine - see [Commit](https://github.com/pme123/orchescala/commit/9e00688d291e229b1d6fea94c7488767e312025a)
- Orch Spec: a service with own outputs but without _manualOutMapping/_outputVariables is mapped manually; what the init worker always sets is not optional; a condition differing only in execution.getVariable follows the data model - see [Commit](https://github.com/pme123/orchescala/commit/03578cd02788af16bc0c0cc29651abd28c58f17f)
- Company generator: test the worker-op dependency for a company adding Op later - see [Commit](https://github.com/pme123/orchescala/commit/f3f27575af3b7aae222c8142e3cb9f9cc79c90af)
- Company generator: fail early without a company engine; explicit test expectations - see [Commit](https://github.com/pme123/orchescala/commit/f268f3f405c873c20e343fde24a7f4fb275c2b0e)
- companyCheck: compile Camunda 7 and 8 again as well - see [Commit](https://github.com/pme123/orchescala/commit/ead4f86a533709a4dd08fb26a47f67846b0d8592)
- companyCheck: also compile an Operaton-only company; explicit engine context names - see [Commit](https://github.com/pme123/orchescala/commit/ecaf6a292ef1b7e2048c3772342accfeadb497b4)
- Company generator: test the wrappers for each combination of engines - see [Commit](https://github.com/pme123/orchescala/commit/6b743085ccf19500791b39649079eadaf1d56499)
- Worker: C7Worker and OpWorker can be mixed in one worker - see [Commit](https://github.com/pme123/orchescala/commit/1b11eca7788c3d34f950b7ed18483ca3c9f95952)
- Orch Spec: Camunda 7 conditions - FEEL goes into the diagram as JUEL, a raw = … is translated on export; a variable that may be unset is read with execution.getVariable; View DRD works in the DMN editor - see [Commit](https://github.com/pme123/orchescala/commit/8ce1c607a74590526064721c4f639a9ef8dd8e51)
- Company generator: Operaton (EngineType.Op) support in the company wrappers - see [Commit](https://github.com/pme123/orchescala/commit/168eb988afef28d4a974d9ed078cd4a8bf6be4d9)
- Orch Spec: edit the DMN table of a DMN Decision with dmn-js - from the project (camunda / camunda8), a file or new; In/Out and result form follow the table; processFromSpec writes the tables next to the BPMN - see [Commit](https://github.com/pme123/orchescala/commit/da958ecdcb799936c910572263174eeea92f2d17)
- Orch Spec: DMN Decision as interaction - In/Out in the data model, result form selects singleEntry/singleResult/collectEntries/resultList; mapping name and expression share the row 2:3 - see [Commit](https://github.com/pme123/orchescala/commit/b340123cfef35ac473fbf8f18baafe94505dd3f4)
- README: Testcontainers mit Colima - see [Commit](https://github.com/pme123/orchescala/commit/2697f03f69271034d2618e64ab79388c26f7f0a7)
- Orch Spec: «Prozess-Bezeichnung» as a built-in Orchescala pattern - processLabels, callingProcessKeyDE/FR in the Out; the field description is a FEEL field; a pure FEEL path stays a Scala reference - see [Commit](https://github.com/pme123/orchescala/commit/e02bde699117c35548b31083c810d6850142bea7)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](https://github.com/pme123/orchescala/commit/6d336899331f8ccfc47a21ecbf43df510438d291)
- Merge pull request #22 from pme123/feature/worker-roles - see [Commit](https://github.com/pme123/orchescala/commit/773c033a6ec6aca4dd3654f4fdfdf6aa4989888a)
- WorkerConfig.rolesTimeout: document the thread of an override that ignores the interrupt - see [Commit](https://github.com/pme123/orchescala/commit/46f19168a223f0199011d6bc05c24ac3acb83811)
- Review #22 (5): rolesTimeout is a hard bound, also for a rolesOf that ignores interrupts - see [Commit](https://github.com/pme123/orchescala/commit/12e6eadc832c417deb9f6e88b49761df893283b2)
- Orch Spec: processLabels in the process panel - callingProcessKeyDE/FR are known variables; processFromSpec adds missing processLabels; a reference like processLabels.de stays Scala in a text example - see [Commit](https://github.com/pme123/orchescala/commit/7164d8b1bf744234bc1f8ebac46ae60081d65983)
- Orch Spec: a text example needs no quotes; a click in the diagram no longer moves the view or reduces a multi-selection - see [Commit](https://github.com/pme123/orchescala/commit/2b176f711ce9436e329f93771c17aeae218e4040)
- Orch Spec: the example of a field can be FEEL - translated like the default, a single value gets the wrapper of the field - see [Commit](https://github.com/pme123/orchescala/commit/584dd1e4692edf4a2db8abe5f8f5bb8cf8526cf5)
- Review #22 (4): rolesOf with a timeout, only failures become 503, more role tests - see [Commit](https://github.com/pme123/orchescala/commit/d80ab8bb10a393bd3fcd839ccd3078e3361755aa)
- Orch Spec: a pattern can set the assignment - it shows under «Zuständigkeit» and locks groups and person - see [Commit](https://github.com/pme123/orchescala/commit/e69930ecc58143759359fe11338eb83bbba71d63)
- Orch Spec: copy and paste across processes and tabs - diagram elements with all spec data, classes and fields - see [Commit](https://github.com/pme123/orchescala/commit/89eae9b7bc6142e603d7a91ecc94544b9a039df7)
- Review #22 (3): TokenValidation.verifies as the one gate, 503 when roles cannot be checked - see [Commit](https://github.com/pme123/orchescala/commit/cd7dbc5603cd3e4b23ade1be6aee25d7af10fb86)
- Orch Spec: user tasks - assignee, candidate groups and candidate users as FEEL fields - see [Commit](https://github.com/pme123/orchescala/commit/7714488606a4dc5ac3ca7759b6b2999cd47dcb5a)
- Review #22 (2): audience documented, rolesOf on the blocking pool, test IdP stopped - see [Commit](https://github.com/pme123/orchescala/commit/67a09a568550ee1f8f2b94d9715068f3bbb5209c)
- Review #22: roles fail closed, client roles only for configured clients, no defects - see [Commit](https://github.com/pme123/orchescala/commit/42ce01a6890e6d66d769c94bf1a4a48c1512ce17)
- Worker roles: WorkerDsl.requiredRoles - checked for /worker/{topic}, else 403 - see [Commit](https://github.com/pme123/orchescala/commit/22831ee04a220b5e2fad5c347df60a191ea5427e)
- Orch Spec: descr of custom tasks and user tasks - multi-line, expressions, always written - see [Commit](https://github.com/pme123/orchescala/commit/b7e2d9889756416672cea6f22c936ca27ea22691)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](https://github.com/pme123/orchescala/commit/367441ee57586d1f58bc05be7fc280bea5e8b8bd)
- Merge pull request #21 from pme123/feature/platform-durchstich - see [Commit](https://github.com/pme123/orchescala/commit/bfbf439b61b9a2145180c7f2e17bc1643e41aaa3)
- Orch Spec / processFromSpec: imports of objects in descriptions; processLabels through the export - see [Commit](https://github.com/pme123/orchescala/commit/0c2a3615991af5f1674dae63506b9c6114dbc68e)
- Orch Spec: imports follow the domain files - LoadPoas from the import, defaultValidUntil keeps its import - see [Commit](https://github.com/pme123/orchescala/commit/ad40175a68187621d2b1018c1e7b84d66d3b862c)
- PersistenceWorker packages: DSL in orchescala.worker, types in orchescala.worker.persistence - see [Commit](https://github.com/pme123/orchescala/commit/2472079f4ac9f4500e048c17938a733491870e75)
- PersistenceWorker: interface in 03-worker, Postgres in 04-persistence-postgres - see [Commit](https://github.com/pme123/orchescala/commit/e891d959038bd7b5532eac331dd02753fdc0e7b8)
- PersistenceWorker: module 04-persistence - it builds on 03-worker and is implementation specific - see [Commit](https://github.com/pme123/orchescala/commit/76c5bc78bde67932014b26c41a593545b67aa35e)
- Review #21 (10): every lock wait of a change is Busy, bounded DDL wait, backend built once - see [Commit](https://github.com/pme123/orchescala/commit/2207e282d14548ca5c57256da2524a8ca09beb07)
- Review #21 (9): no password from the JDBC URL in the log, bounded UI memory, 64-bit lock keys - see [Commit](https://github.com/pme123/orchescala/commit/6a3ae443fa42424a28432b441ea13de8bb16c425)
- Review #21 (8): connection timeout, bounded read of UI files, jar branch tested - see [Commit](https://github.com/pme123/orchescala/commit/12abf9781383a4d1cb4ae42ccd17c07966216d0f)
- Review #21 (7): assets never fall back to index.html, weak ETags, exact conflict version - see [Commit](https://github.com/pme123/orchescala/commit/da2cf86cfde2cb07a8225e491d010dc45c7be214)
- Review #21 (6): bounded lock wait, configurable UI limit of the worker app, audit user via AuthContext tested - see [Commit](https://github.com/pme123/orchescala/commit/9044f1a77509b2f4b7159368abbbcc0729f89b35)
- Review #21 (5): one old row does not break a query, security headers on every answer - see [Commit](https://github.com/pme123/orchescala/commit/56ef05e5ef556b0b6fa63f110946c76e9f908b02)
- Review #21 (4): unverified audit users are marked, managed stream read, forward tested end to end - see [Commit](https://github.com/pme123/orchescala/commit/8f8998b7e90aeb5cbb67cac3d1d22c9b0d7ed73f)
- Orch Spec: C7 call activities pass impersonateUserId - see [Commit](https://github.com/pme123/orchescala/commit/ec16ed1e6701ac0ab0903e17d55e446cfb29943e)
- Review #21 (3): no duplicate audit versions under a delete/re-create race, bounded reads - see [Commit](https://github.com/pme123/orchescala/commit/d56c41b3d1c8e5e15aa15cbcac0804804c9bf9ad)
- Orch Spec: _servicesMocked & co. only where a sub process needs them - see [Commit](https://github.com/pme123/orchescala/commit/23ad05dd9adc7b6502ee974db81b22e44870a28f)
- Review #21 (2): no write that cannot be read back, readable old audit entries, persistence tests on CI - see [Commit](https://github.com/pme123/orchescala/commit/0af9c173999976c3151db21a2815d9bbd8bed365)
- Review #21: audit log never without its change, versions continue after re-create, safer UI paths - see [Commit](https://github.com/pme123/orchescala/commit/10039d110a5fcae04a78cc9d57afbb700b1410b1)
- Orch Spec: call activities pass control variables with source="..." instead of sourceExpression - see [Commit](https://github.com/pme123/orchescala/commit/a35cae002f1c9790d648f9cd637dbec3bb90af22)
- Orch Spec: the type picker shows a Scala type of the domain without warning - see [Commit](https://github.com/pme123/orchescala/commit/f81b03d202b1027355c6c8ee15cd0868a53d2b7e)
- Orch Spec: «Mappings aus dem BPMN übernehmen» when syncing with a BPMN - see [Commit](https://github.com/pme123/orchescala/commit/b7b220fd9c6b4a9b36d4be701cdc49c2e7cef6f8)
- PersistenceWorker: audit log - every change is recorded in {table}_history - see [Commit](https://github.com/pme123/orchescala/commit/5b99bab0e4e7789c053455f6370c5588c4b0a392)
- Orch Spec: Instant is a simple type; MockedServiceResponse[...] is no unknown type; examples copied from exampleMinimal - see [Commit](https://github.com/pme123/orchescala/commit/95f239cbe4adc39c03a0c40c83d6cf14d5783479)
- Orch Spec: the BPMN export reads the diagram where an older spec does not know - no more parallel writes of master/person - see [Commit](https://github.com/pme123/orchescala/commit/32d895c3d7c112081104950c99b35f4aa6284f2c)
- PersistenceWorker: worker apps keep their own data in Postgres (new module 03-persistence) - see [Commit](https://github.com/pme123/orchescala/commit/e56afd41d8b28b450aca0b394f2748a6940236e9)
- Gateway: the UI bundle of a project comes from its worker app via /app/{projectName}/ - see [Commit](https://github.com/pme123/orchescala/commit/a50f5526836e03b29bb08235be0f008c24eb5033)
- Orch Spec: the BPMN export keeps how a service returns its outputs; never _outputVariables on the init worker - see [Commit](https://github.com/pme123/orchescala/commit/4f8ea35cf66a68ad49cfe99cabef55e47411ed35)
- Orch Spec: the class builder panel is centered at a readable width again - see [Commit](https://github.com/pme123/orchescala/commit/c4b3ca137c86549224271c34af18b6c9474ba362)
- Orch Spec: typing in the class builder no longer lags; fields are uniform and use the whole width - see [Commit](https://github.com/pme123/orchescala/commit/7c8a58b1083d9c9aacf5275cb3ee37753860c74b)
- Orch Spec: a field in the class builder in three lines - name, type, meaning - see [Commit](https://github.com/pme123/orchescala/commit/d0e8de7272861a53e5fd532a409429c37877f5d9)
- Orch Spec: long field names, types and descriptions are shown in full in the class builder - see [Commit](https://github.com/pme123/orchescala/commit/cedefff8a64ed08a6830289d508b3ad04616ce15)
- Orch Spec: the InConfig is imported with its mocks; a mock keeps the name the BPMN gives it - see [Commit](https://github.com/pme123/orchescala/commit/a52c5b04caafffefe7eb48ba23c194a5c47201fa)
- Orch Spec / processFromSpec: process objects are named without version; called objects come from the catalog - see [Commit](https://github.com/pme123/orchescala/commit/98e69099afcb318f6cec6dd44b70205c59136578)
- processFromSpec: merges Orch Spec into an existing process object - see [Commit](https://github.com/pme123/orchescala/commit/40db26e292811d49885d2090ed84f4094363381b)
- Orch Spec: process object in the order In, InitIn, InConfig, Out; orchescala types without import - see [Commit](https://github.com/pme123/orchescala/commit/82dd6786e633acc761fb1bb25a05ad9a44ddb6c7)
- Orch Spec: Markdown fields render formatted and get a formatting toolbar - see [Commit](https://github.com/pme123/orchescala/commit/c06425ce70c947420bd6a3cfd10aa50bea02cd46)
- processFromSpec: inConfig is always initialised with None - see [Commit](https://github.com/pme123/orchescala/commit/56be25e08ab0bdb124f210e8e6fed11e0354319a)
- Orch Spec: domain examples and @description references survive import and export - see [Commit](https://github.com/pme123/orchescala/commit/3568fb1ff4629ffcfdef67026b67907ea2d5ec3e)
- Orch Spec: comments and history as a floating card like arch-review - see [Commit](https://github.com/pme123/orchescala/commit/f1e04818d1daf612d1da87f5f6de985fdc79472b)
- Orch Spec: emojis in comment text; reactions offer the same 40 emojis - see [Commit](https://github.com/pme123/orchescala/commit/fe934492020af44c76ead408c373a59f97cbf37f)
- Orch Spec: comments get emoji reactions - see [Commit](https://github.com/pme123/orchescala/commit/58e5e2f4e47de0d968440071ede960d9caca0d78)
- Orch Spec: a damaged users.json is backed up, never overwritten - see [Commit](https://github.com/pme123/orchescala/commit/7912824c7f1e9479b914e027dddb6530269f2170)
- Orch Spec: choosing a service names a step that still has its default name - see [Commit](https://github.com/pme123/orchescala/commit/6783acc0cb594e21831b1a66e56008e3b2b2bec3)
- Orch Spec: every delete asks first - see [Commit](https://github.com/pme123/orchescala/commit/4cffae4340b98b8bae19d54538dc9781a56cb25b)

## 0.8.1 - 2026-10-02
### Changed 
- Orch Spec: messages and signals of another process (name not starting with the own process id, e.g. valiant-bpmn-stopEscalation-…) are wiring — no interaction, no prepared draft - see [Commit](https://github.com/pme123/orchescala/commit/244ea3d3f8b28d97579286c9d4ba5583861d55e4)
- Orch Spec: steps that belong to a pattern get no prepared interaction (wiring, no domain object) - see [Commit](https://github.com/pme123/orchescala/commit/07490e30155f4e4c7446ad8e7c8cafccc765fbfa)
- Orch Spec: imported classes remember their domain type (domainId) — a class of the own process is not «already in the domain» just because an older catalog still has it nested in an object - see [Commit](https://github.com/pme123/orchescala/commit/1f2c27d4969295b2fbce15121cbc66a8dc8cd7f9)
- Orch Spec: the process's schema classes are always imported; types nested in the own process object belong to the spec (not «already in the domain») and stay in the object on export; a warning lists classes that are nowhere in the domain - see [Commit](https://github.com/pme123/orchescala/commit/f14dad7be9993f1db00f962679f83ad4beecafa4)
- Orch Spec: types nested in the process object stay there in the export (inProcessObject) — written into object OrderCard, not into schema/ - see [Commit](https://github.com/pme123/orchescala/commit/592cd1b2dd88782b2d77d597b79ca81e871d598c)
- Orch Spec: domain import — a type name resolves in the same object first (no longer to a same-named enum of another object); types nested in the process object itself become classes of the data model - see [Commit](https://github.com/pme123/orchescala/commit/6137e8e785fff3162ccc2c8e7e39e7fd802eb9a4)
- Orch Spec: only new classes in the data model, existing ones referenced - see [Commit](https://github.com/pme123/orchescala/commit/1b7b177852a20037549cdd792686eeb9b813db07)
- Orch Spec: a class of another domain is imported, not exported - see [Commit](https://github.com/pme123/orchescala/commit/e8da5ffe6a4b16c64d4bec1a0795de5e4ec95afc)
- processFromSpec: no domain object for a custom task of another project - see [Commit](https://github.com/pme123/orchescala/commit/9b8421d8998e5d67ab8037154fa77f923309a8f1)
- Orch Spec: an interaction of another domain is referenced, not exported - see [Commit](https://github.com/pme123/orchescala/commit/7b5aebd69804f53c6d93f85cb6b48be2256a83dd)
- processFromSpec: workers only for the custom tasks of the process - see [Commit](https://github.com/pme123/orchescala/commit/c9e65c679d0099e67430914fde7c5d95b0ceac8b)
- Orch Spec: a general variable is no catalog extension - see [Commit](https://github.com/pme123/orchescala/commit/1b004b104ec4bd212d87e2fd239e2248c7c3638c)
- Release: the version must follow the last release - see [Commit](https://github.com/pme123/orchescala/commit/0800d04d1cfaed4b2d9e8b188e64523a5ead5d72)
- Orch Spec: an own In/Out class that is an enum with fields has variants too - see [Commit](https://github.com/pme123/orchescala/commit/4c4702f782b5af4f5fa91cc990c6d6b6d8643891)
- Orch Spec: steps of a pattern block have no own inputs and outputs; the selected step shows in the tree - see [Commit](https://github.com/pme123/orchescala/commit/1624c068355c01ef94d36fd4f1a520a480506553)
- Orch Spec: a collapsed step (gateway, sub process, error path) and a closed pattern block show the findings of the steps below - see [Commit](https://github.com/pme123/orchescala/commit/79b75918582bc8045018c0e7fa122f5d96badb4c)
- Orch Spec: a deselected output that _outputVariables lists gets checked (rows added on open before the sync brought the list) - see [Commit](https://github.com/pme123/orchescala/commit/027ab60eb533457305967208a7090ade978b6278)
- Worker: the request body of a failed service call in the incident - see [Commit](https://github.com/pme123/orchescala/commit/6a8b3ab5d6cb3e740f6ab2ca592f8508fbef1d38)
- Orch Spec: service steps show all fields as rows — required inputs and the outputs the process needs (_outputVariables, read on import) checked, the rest deselected; mixed output cases switch to «alle Ausprägungen» - see [Commit](https://github.com/pme123/orchescala/commit/a2b21aded43958935d221fa4fcc69359339e3954)
- Orch Spec: execution.* (C7) — processInstanceId/processBusinessKey become FEEL (processInstanceKey/businessKey) and back to execution.* for the C7 export; others stay JUEL with a warning; engine variables are known to the FEEL check; old «= execution.…» values heal on load - see [Commit](https://github.com/pme123/orchescala/commit/fe778e4ce9ff8a24ea0d3c8faa9bba0f2a1e0902)
- Orch Spec: root folders with the same name get their own key («projects (2)»); a decision the catalog does not know yet but the domain does counts as known (entry from the domain object) - see [Commit](https://github.com/pme123/orchescala/commit/59d843b4aa2e80718246030b44353fead7a2a269)
- Orch Spec: a project that is not in its (readable) root folder — e.g. a second folder of the same name — gets its own «Ordner wählen» button instead of the root's - see [Commit](https://github.com/pme123/orchescala/commit/6a1133a71057678f4e0a53aadd88f8fa5f00be8c)
- Orch Spec: missing folder access can be granted right at the message — confirm the remembered access or pick the folder (access is remembered per app address), then the catalog is rebuilt - see [Commit](https://github.com/pme123/orchescala/commit/b9ccdf7bc89794440548a7a511f98b1f78923fa4)
- Orch Spec: the Out of own workers and user tasks counts as process variables (they set it without mapping) — from the described interaction, else from the domain - see [Commit](https://github.com/pme123/orchescala/commit/4e171d0fbb4324d7b7f54d4f98ea3b60486f2660)
- Orch Spec: a decision step says Decision and decisionId instead of Service and Topic - see [Commit](https://github.com/pme123/orchescala/commit/6bef903f2ab7846851913688723edc0ec43564a8)
- Orch Spec: DMN support — a decision finds its domain object by decisionId; resultVariable and mapDecisionResult (BPMN, else the example factory, else the engine default) make the result known to the FEEL check - see [Commit](https://github.com/pme123/orchescala/commit/4f2b9cb122e0596e5b11094911230171a9175f09)
- Orch Spec: process variables — InitIn and InConfig win over In for the same name (the init worker sets the required twin), so an optional In field with an InitIn twin is not flagged - see [Commit](https://github.com/pme123/orchescala/commit/5b6dd5cb3c7c6115000e66640fff78148f1d5963)
- Orch Spec: FEEL check — item.x in a filter is checked against the list's elements; unknown elements (JSON, list without known fields) give no verdict; a missing path is reported once - see [Commit](https://github.com/pme123/orchescala/commit/775a08363538f89a755ac2b5166452ffcd34568b)
- Orch Spec: FEEL→JUEL knows list filters (→ Spin jsonPath), count() and empty lists — round trip with the import is stable; scripts taken from the BPMN get a warning (kept for C7, rewrite for C8) - see [Commit](https://github.com/pme123/orchescala/commit/23d24e7c6eed86e611f880eff4fdde0ac3e83f16)
- Orch Spec: JUEL→FEEL knows Spin jsonPath filters ($[?(@.x == 22 || …)] → list[item.x = 22 or …]), indexes, .elementList(), and empty on lists - see [Commit](https://github.com/pme123/orchescala/commit/bb82229b5693d490d19719147a751c91dba6c1ef)
- Orch Spec: outputs of an enum Out can use «alle Ausprägungen» — fields of every case, no mixed-case warning - see [Commit](https://github.com/pme123/orchescala/commit/a23eb1f669c014bca8bad5faaaa835692e66b61f)
- Orch Doc: dependency graph draws one arrow from the selected project straight to each project of its depends-on list - the chains between them are the grey base arrows already - see [Commit](https://github.com/pme123/orchescala/commit/8c09983e7cbabbb0d1ce8e45f195ee49abdd207e)
- Orch Spec: «Mit BPMN abgleichen» with a preview — domain merge of the data model, status for new and changed, comments stay; syncs go into the audit log - see [Commit](https://github.com/pme123/orchescala/commit/14b8a0abe3372f3dfd8987b2f29bcd41c78e46af)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](https://github.com/pme123/orchescala/commit/0e924ac35f872a53786494ab063b5d4e24d0a9e0)
- Orch Spec: own icons for the two syncs — a small BPMN flow (process) and a small UML class (data structure), each with a sync arrow - see [Commit](https://github.com/pme123/orchescala/commit/f0fe2f8b0f0cca568a529924844e5f829cf06fe4)
- Orch Spec: missing required service inputs are also added when a spec is opened (once the catalog is there) — existing specs heal without a sync - see [Commit](https://github.com/pme123/orchescala/commit/f514175a5ef9761135133b658f1901896a17a4ff)
- Merge pull request #20 from pme123/claude/clever-tharp-2e7ba2 - see [Commit](https://github.com/pme123/orchescala/commit/14c9fdeaed4039a1d9705faa350a4d47ad82426e)
- Orch Spec: history panel filters by time range — today, last 7 or 30 days, or from–to - see [Commit](https://github.com/pme123/orchescala/commit/b7ecc10fc90962213a8b2fda274ea1bd5795c416)
- Orch Spec: history panel filters by person and has a text search over place, field, values, note and report - see [Commit](https://github.com/pme123/orchescala/commit/179b72681414394b9f5d19e351d32173db7c3664)
- Orch Spec: audit log for all changes to a specification — who changed what, when and why - see [Commit](https://github.com/pme123/orchescala/commit/8a69ae7cd210fb5670f09b9eeadb214c21523284)
- Publish docs: MOVE sends the destination as a path - see [Commit](https://github.com/pme123/orchescala/commit/998d8196491269dc2f9b18f83d22c9f4dbc1c2ce)
- Orch Doc: dependency graph highlights exactly the projects of the selected project's depends-on list (direct edges bold, indirect dashed) — no longer just the direct edges - see [Commit](https://github.com/pme123/orchescala/commit/34972a9ec1dc3bd28317c0526970136c8324b34d)
- Orch Spec: importing a BPMN adds missing required inputs of services and call activities as rows (= name) — same rule as the missing-required finding - see [Commit](https://github.com/pme123/orchescala/commit/661d36f31eee954eb3705211bc9b45c7b8910808)
- Orch Spec: branch conditions accept null in both engines — C8 export writes them null-safe as (…) = true (like JUEL, where null is false); import and C8→C7 strip the wrapper - see [Commit](https://github.com/pme123/orchescala/commit/026cecd57a505bf3fb57b078044e5ca9d356fd89)
- Orch Spec: an optional value in a branch condition is fine in C7 (JUEL: null is false) — the warning stays for C8, where null is an incident - see [Commit](https://github.com/pme123/orchescala/commit/6054f7cd6b88778adb4e8e1943f65a642b25734c)
- Orch Spec: findings shown at their place (mappings, handled errors, branches) are no longer repeated in the list at the top of a step - see [Commit](https://github.com/pme123/orchescala/commit/bd813f6fc6d2dda373f47e552d540345accbad1e)
- Orch Spec: signals and messages may have an empty In — no warning - see [Commit](https://github.com/pme123/orchescala/commit/f271938ef9d9078973a0a30b0234bf41e342ed83)
- Orch Spec: the domain comes from the own project folder first (current sources), the catalog only after — a changed domain is seen without rebuilding the catalog - see [Commit](https://github.com/pme123/orchescala/commit/9a1c6efb03516b51f9ca8fd289e1909602fce9ba)
- Orch Spec: an old process ID can be marked «alter Name» — the naming convention is not checked then - see [Commit](https://github.com/pme123/orchescala/commit/9ec279eb965928eb191a2b38a85960dfb8be53a5)
- Orch Spec: pattern parameters work like mapping values — with = they are FEEL (checked, completion), written as ${…} in C7 and =… in C8; a FEEL value replaces a quoted placeholder in C8 - see [Commit](https://github.com/pme123/orchescala/commit/8cadfccebbcff4c55f25cc29afd92cde5997aafa)
- Orch Spec: a fixed case of a simple enum as field type (X.case.type = X.case) — picker, import, givens for own enums, FEEL value check; ProcessStatus from orchescala.domain is built in - see [Commit](https://github.com/pme123/orchescala/commit/f981e0e1e18f662c66a695f20444859df3db3f27)
- Orch Spec: InitIn takes defaults like InConfig — they initialize the process variables and go into the case class - see [Commit](https://github.com/pme123/orchescala/commit/2fcded32e511558b496ed39249dab802ab9a4959)
- Orch Spec: no more «Offene Frage» and «Technische Notiz» at steps — comments replace them; old entries are dropped on load - see [Commit](https://github.com/pme123/orchescala/commit/b59b9ba304cf7164be6849f85844c49c0b547247)
- Orch Spec: process patterns bring their whole block; a missing message start is created - see [Commit](https://github.com/pme123/orchescala/commit/7d0b1a528df0c89a76e94664d2b0697c449c7755)
- Helper: processFromSpec registers the process alphabetically in WorkerApp and ApiProjectCreator - see [Commit](https://github.com/pme123/orchescala/commit/7d4c47499ce490a56816391dc1a82d5acdcca279)
- Orch Spec: the process object gets the imports of the InitIn's own fields too - see [Commit](https://github.com/pme123/orchescala/commit/b0ec22cfe2794c2bf4ae5a4946d0e5d6fa9406f4)
- Orch Spec: an interaction whose step is no longer in the flow is not exported - the class builder marks it and offers to remove it with its In / Out - see [Commit](https://github.com/pme123/orchescala/commit/952815f04524d2e334ca0f624270df2caf33c01f)
- Orch Spec: examples take the domain's default values - `clientKey = defaultClientKey`, like the projects do by hand - see [Commit](https://github.com/pme123/orchescala/commit/cea51739fe7579a155621a387c4b232d8fc13d43)
- Orch Spec: defaults never in a class but the InConfig - an optional field of In with a default gets its required twin in InitIn, set by the init worker - see [Commit](https://github.com/pme123/orchescala/commit/73ab9ea3fd874c7d5e4d265091b8c2805fc813f6)
- Orch Spec: the default of a field is FEEL (with «=») - the export writes it as Scala according to the type of the field - see [Commit](https://github.com/pme123/orchescala/commit/64eb6fa3bfde43e64ddbd3eee43b613df1d4b86a)
- Orch Spec: unfinished fields stay out of the Scala code - without name, without type or with a missing own type; types and interactions without name get no file - see [Commit](https://github.com/pme123/orchescala/commit/e27bdf6884b9977a06330ddb9884f8845872b8cc)
- Orch Spec: the BPMN export tidies up what the Modeler's linter reports - no duplicate or unused messages / errors / signals, boundary events with a name - see [Commit](https://github.com/pme123/orchescala/commit/196b15a1065f84eb4e33c831c013ab43d477ebbd)
- Orch Spec: the BPMN export writes the implementation of the spec - topic of a service task, called process of a call activity (C7 and C8) - see [Commit](https://github.com/pme123/orchescala/commit/0895bd19cac0f7fddf58125a51b8a50934296e6f)
- Helper: processFromSpec re-run - adds new workers / interactions to WorkerApp and ApiProjectCreator, compares existing classes and BPMN with Orch Spec (UNCHANGED / DIFFERS) - see [Commit](https://github.com/pme123/orchescala/commit/9e451960e27223434c2ef591b07c1626ec67f9f0)
- Orch Spec: "Process from Spec" takes the BPMN of the engine chosen in the BPMN tab; wider export dialog, buttons without wrapping - see [Commit](https://github.com/pme123/orchescala/commit/be6c72b574a9862b31190dccf7e897bf92c821a2)
- Helper: processFromSpec creates a process from the Orch Spec export - "Für Helper kopieren" copies the whole command (orchspec: + gzip of BPMN and Scala classes) - see [Commit](https://github.com/pme123/orchescala/commit/9792a42538405d32d0b14646084f7b59ceb8e43a)
- Project colors from the Orchescala config: prepareDocs writes ProjectConfig.color into the spec catalog, orch-spec uses them (a color in Admin overrides) - see [Commit](https://github.com/pme123/orchescala/commit/2003fa0da492d717609ced646080cb76b5884978)
- Orch Spec: project colors — a color per project folder; choosing a worker or call activity colors the element like colorForId - see [Commit](https://github.com/pme123/orchescala/commit/080d6d0dc0b5b770a7f4f1626a37c8702c4efa19)
- Orch Spec: export file names are project-processVersion (without company) from the current process ID, e.g. savings-openSavingsV1.bpmn - see [Commit](https://github.com/pme123/orchescala/commit/ee21725a7131c7565de70f31ecac25c78cc11b94)
- Orch Spec: unknown variable names are escaped before the loop-variable RegExp - names like «??» no longer crash the app - see [Commit](https://github.com/pme123/orchescala/commit/a2e885cd7d78dd9459fa8452a4e3da730f050ec0)
- Orch Spec: specs are read in parallel (max 8) together with model and users; a spinner while the list loads - see [Commit](https://github.com/pme123/orchescala/commit/624e62fca5e42d51b5c5b4d3c442e3c75becaef7)
- Orch Spec: _identityCorrelation always goes into a call activity - see [Commit](https://github.com/pme123/orchescala/commit/8fd6d3136d75142e219a16fbfc5d218ec1cbc030)
- Gateway: sendSignal only fails if no engine accepts the signal - a not reachable engine (e.g. C8) is logged as warning - see [Commit](https://github.com/pme123/orchescala/commit/b8309be67536fddfc91fa3eec36e07261bc4b16c)
- Orch Spec: _servicesMocked (and _mockedWorkers at call activities) always go in; the bpmn-js context pad stays below dialogs - see [Commit](https://github.com/pme123/orchescala/commit/77e151314de51d68ec636c319232860449df3d8d)
- Orch Spec: mocks per step — _outputMock or _outputServiceMock (service workers) with an InConfig field, else _servicesMocked (and _mockedWorkers at call activities); _ parameters always last - see [Commit](https://github.com/pme123/orchescala/commit/a881ce8cc2253326fa0d3aa84de8c7422404c00b)
- Orch Spec: a FEEL entry in handled errors may yield a text or a list of texts — flatten in C8, alone as ${…} in C7 - see [Commit](https://github.com/pme123/orchescala/commit/2b23e108683534cfd8b3666de9fafbbb2e7974af)
- Orch Spec: handled errors and regex entries starting with = are FEEL — checked, with completion, as list elements in C8 and ${…} in C7 - see [Commit](https://github.com/pme123/orchescala/commit/25f0968af5acd3a9f1e2d0b790cab1728a77a996)
- Orch Spec: handled errors — no repeated messages at the top, help on what the code (messageType) and the regex (message) match - see [Commit](https://github.com/pme123/orchescala/commit/b3af75600001c833b7e9dbc90e28ed9af5e3d199)
- Orch Spec: _regexHandledErrors is a list of regular expressions — list in C8, comma separated text in C7, each one checked - see [Commit](https://github.com/pme123/orchescala/commit/02535020f9d1476528356b47322645aa01a872ee)
- Orch Spec: a new handled error gets a free placeholder code; side paths are not listed as errors; only a path that leads nowhere is reported - see [Commit](https://github.com/pme123/orchescala/commit/5abeb44763b27401ff68f97008eac843afa66285)
- Orch Spec: _outputVariables is a comma separated text in C8 too; NONE without variables and then no _manualOutMapping - see [Commit](https://github.com/pme123/orchescala/commit/39b53b5772ba244f6d6970c751da8cc27ed58bea)
- Orch Spec: a service with outputs gets _manualOutMapping and _outputVariables from its FEEL outputs; C8 handled errors are lists - see [Commit](https://github.com/pme123/orchescala/commit/2381affd600a1213db702980dc5666d936f7ae08)
- Orch Spec: handled errors and _regexHandledErrors are written the same way for Camunda 8 (zeebe:input) as for Camunda 7 - see [Commit](https://github.com/pme123/orchescala/commit/3f1a16fd7a65db859d066fd665ce3f9dc4967910)
- Orch Spec: a validated text field for _regexHandledErrors instead of a per-error switch - see [Commit](https://github.com/pme123/orchescala/commit/0e6033299657837a0b4a63f943be6e85e6d816ef)
- Orch Spec: handled errors know _regexHandledErrors next to _handledErrors; side paths no longer count as handled errors - see [Commit](https://github.com/pme123/orchescala/commit/19ac624ddf2e9a7375fa9dfe8c62317faa0d8883)
- Orch Spec: the business key always goes to a sub process — camunda:in businessKey in C7, variable businessKey in C8 - see [Commit](https://github.com/pme123/orchescala/commit/26877c14cbceb63dbdcae2d407cf0797a26064c9)
- Orch Spec: FEEL check knows Camunda functions, multi-instance scope, coloured completion with explanations and a cheat sheet in the top bar - see [Commit](https://github.com/pme123/orchescala/commit/d7e961a8c282b7836ec889961415abc7f769368a)
- Orch Spec: a service In/Out with cases takes one variant; without a choice only the common fields count - see [Commit](https://github.com/pme123/orchescala/commit/a26b9a773147ba56c01861148bcee9271b7b6013)
- Orch Spec: a handled error is no warning; only an empty, duplicate or placeholder code is reported - see [Commit](https://github.com/pme123/orchescala/commit/fda9e0f4fb4ae3ab88c83a27c4982a517d12ff32)
- Orch Spec: SharePoint asks for the folder link first, signs in on connect and keeps the link across the redirect - see [Commit](https://github.com/pme123/orchescala/commit/6a5f5b03d814d84759d4fd242712c0925a696c6d)
- Orch Spec: comment links in Teams carry the setup; the folder of a link wins over the remembered one - see [Commit](https://github.com/pme123/orchescala/commit/66c69f53f3fba47eb6760c8d9e640f499eb76075)
- Publish docs: the apps' old hashed assets are removed before the new ones are copied - see [Commit](https://github.com/pme123/orchescala/commit/634d3c47fe8cf10a252459df209fdb245ac228a1)
- Orch Spec: first the folder, then the sign-in; the sign-in card names the folder - see [Commit](https://github.com/pme123/orchescala/commit/4125043cb2560acddc56736421024666a94313e5)
- Orch Spec: an exported catalog imports again; the generated mark stays out of files - see [Commit](https://github.com/pme123/orchescala/commit/0fed066402fc4bf07fdbbeb9fc21b7a3f2b37c6b)

## 0.8.0 - 2026-09-28
### Changed 
- Orch Spec: patterns for Send Process Event and Init Process; pattern mappings stay out of sight - see [Commit](git@github.com:pme123/orchescala/commit/17a44d6551596487e901b3648584be8a5d69ac6e)
- Orch Spec: a sync with the BPMN keeps the service settings of the specification - see [Commit](git@github.com:pme123/orchescala/commit/af86d43f222a69944573e85a550f23317951fa7e)
- Orch Spec: process id checks company and project against the known ones - see [Commit](git@github.com:pme123/orchescala/commit/2dc39dc94c637cb88aadb84ccee0cefb2324d09c)
- Orch Spec: business title and validated process id as two fields in the head - see [Commit](git@github.com:pme123/orchescala/commit/0670d31eb939db545743be7199abfcf6d1d81be2)
- Orch Spec: JUEL becomes FEEL wherever it translates - see [Commit](git@github.com:pme123/orchescala/commit/507ee8122b022741e989977eeb7f188ab271e7f4)
- Log: the value quoted by a decoding error is masked - see [Commit](git@github.com:pme123/orchescala/commit/2c5101782b92a5ea1a81cc79982bc181bfe3a64d)
- Publish docs: uploaded to a staging folder, then replaced - see [Commit](git@github.com:pme123/orchescala/commit/ebf6d919e73bba1f4b8d7ad6184f902bb4cdeadb)
- Token calls: waiting instead of rejected, the token exchange off ZIO's threads - see [Commit](git@github.com:pme123/orchescala/commit/62ca4d8a94d2e1396eacae369bcc4fd26671f891)
- C8 worker: only an error worth trying again counts down the retries - see [Commit](git@github.com:pme123/orchescala/commit/fe64ab3136decbd45005e6b928787a51ef309d67)
- Orch Spec: InConfig in the FEEL scope; a default means present; optional-to-required warning - see [Commit](git@github.com:pme123/orchescala/commit/188419f06812abb427201e78b3ae1590d59c3684)
- dockerUp: gives up after 5 minutes - see [Commit](git@github.com:pme123/orchescala/commit/ae78b9e178ae0f0d641ffd7d79cb3f216aea0bd9)
- Release: a clean working tree, only the release branches and tag pushed - see [Commit](git@github.com:pme123/orchescala/commit/5cb20dc10be13d4b9849b46f80ee8b229e89a490)
- Simulation: a refused message fails with its error - see [Commit](git@github.com:pme123/orchescala/commit/46cefbf37c0cd7efec1e9c460c6c875ab678cba8)
- Simulation: the timer step triggers a timer - see [Commit](git@github.com:pme123/orchescala/commit/c29fcdfc5c47d100f1430f92c16a46885ceb9683)
- Deployment: resources with the same file name are refused - see [Commit](git@github.com:pme123/orchescala/commit/5ff93d00fd2c46b23bed9d1e582a6a82d5c96f54)
- Gateway: cached site entries, closed streams, 400 for a wrong deployment request - see [Commit](git@github.com:pme123/orchescala/commit/e07a93810d073ea158438c3a1df18ac3de26e459)
- Orch Spec: InConfig gets own settings next to the generated ones - see [Commit](git@github.com:pme123/orchescala/commit/01ca5065f82e4b533b30a3333cb640b78c5100f4)
- Orch Spec: the title is the process name - renaming it renames process and pool - see [Commit](git@github.com:pme123/orchescala/commit/981911d9d75232224c72374334023da2f1a54289)
- Orch Spec: pool and process share one name; BPMN converts between Camunda 7 and 8 - see [Commit](git@github.com:pme123/orchescala/commit/2c6e8f241a9cb0035d9ba9f947100c546c08751a)
- Orch Spec: the dev server serves the catalog; type search ranks name hits first - see [Commit](git@github.com:pme123/orchescala/commit/c74f02ca5bf800ad4fd51272095743fe5a7e3308)
- Worker: a task waiting for its identity is handed back at once - see [Commit](git@github.com:pme123/orchescala/commit/f327a237da91a075849b54f682d4a58521f11e1b)
- Orch Spec: loadModel sets the model path once, before the first read - see [Commit](git@github.com:pme123/orchescala/commit/a89475590747af04f91a35f0fad8c4215d13ba5a)
- Merge branch 'develop' of github.com:pme123/orchescala into develop - see [Commit](git@github.com:pme123/orchescala/commit/d73a744726cef9d5c157c12435691be5ff00a96c)
- Merge pull request #19 from pme123/feature/neutral-examples - see [Commit](git@github.com:pme123/orchescala/commit/8e40ab44e97bd71b209eb8414a50098242a4e07d)
- Review: shared JiraLinks with tests, fail fast on a repo without host, company title - see [Commit](git@github.com:pme123/orchescala/commit/63a3282d780dae6c3d152996ddd62f17adcb60c4)
- Simulation: stopped after its timeout - it ran on next to the next ones - see [Commit](git@github.com:pme123/orchescala/commit/0ac21e771f541efc62ef109a87ffaf19876198fd)
- Simulation: an incident without message ends the check - no endless loop - see [Commit](git@github.com:pme123/orchescala/commit/c215beaf5cc18a92b55b9933c49e3e1652917271)
- Site tests: company docs only from COMPANY_DOCS_PATH, no fallback path - see [Commit](git@github.com:pme123/orchescala/commit/62b340c753a6383089ffd8ae4c502ea3ee6c0944)
- No personal data in the log - the error details in the incident - see [Commit](git@github.com:pme123/orchescala/commit/8aaddee3a5a9fc54866a0379e2a05301f7450011)
- Identity correlation: a worker waits for the correlation of a start - see [Commit](git@github.com:pme123/orchescala/commit/277e76a1f3f731268e5eebaa06ab41a0a30d985c)
- Engine: variable values on DEBUG, their names on INFO - see [Commit](git@github.com:pme123/orchescala/commit/fe28cfecf29319ec72fc1cbaf6839cd1cc0485ed)
- C7 start by message: a message correlated to a running instance is no start - see [Commit](git@github.com:pme123/orchescala/commit/aeae8a6a7c1853af8a3922ec42b935850e2d49c2)
- Worker: no secrets of a service request in incidents and the INFO log - see [Commit](git@github.com:pme123/orchescala/commit/ba91f1a283aaff42f01752b962d6cf7bb17c4a9e)
- Worker: a job that fails unexpectedly is reported to the engine, engine commands off ZIO's threads - see [Commit](git@github.com:pme123/orchescala/commit/6a9585a485a4267297fdafac413f2ef2d26289b6)
- Worker: default timeout 2 minutes - see [Commit](git@github.com:pme123/orchescala/commit/896d90fbde65f8b2abb8e8c7a76b22317fc8e510)
- Neutral domain examples: savings account, card order, advisor, backoffice - see [Commit](git@github.com:pme123/orchescala/commit/e1ca2140d19d0c89bf593db246092c16ababd92f)
- Neutral system names in examples: crm, core-banking, portal gateway - see [Commit](git@github.com:pme123/orchescala/commit/b213d7df95c45ae4ff5f002269084bc8790aa6a4)
- User task: wait at most 60 seconds, return an active task with timeoutInSec=0 - see [Commit](git@github.com:pme123/orchescala/commit/d93b90a1e5343dd38477debb068207225c2936b3)
- Gateway: a 4xx of the engines is answered as such, not as 500 - see [Commit](git@github.com:pme123/orchescala/commit/11f8be934dbcc829e1574eef6f15b24d4fdce1b8)
- Gateway docs: no host from the path, OAuth code bound to its login - see [Commit](git@github.com:pme123/orchescala/commit/e35fcc71fd84c211cbfc2733e528af457083c069)
- Dummy company names in examples, tests and docs: globex and initech - see [Commit](git@github.com:pme123/orchescala/commit/0de8fab25c0cdf51c2b3564427d14658eb2571c8)
- No company-specific hosts, names or paths in shared code - see [Commit](git@github.com:pme123/orchescala/commit/c37413be767542bfb3b2254465f765c3c0d656ea)
- Changelog: no git credentials in the commit links - see [Commit](git@github.com:pme123/orchescala/commit/839499f2f7a87361e2683fd3d35b57758d53fa2c)
- Simulation: a simulation that did not run is not reported as a success - see [Commit](git@github.com:pme123/orchescala/commit/61450fc80efe505d1cde951990e17f21f23dc83d)
- Orch Spec: loose type names heal to catalog references when a spec opens - see [Commit](git@github.com:pme123/orchescala/commit/2a9bb1f59f7748a14ee206df3c5b20a97c141498)
- Orch Spec: plain type names resolve against the catalog once it knows them - see [Commit](git@github.com:pme123/orchescala/commit/41d442217b57fcffa4d1d14b3495c6367a0b2341)
- Merge pull request #18 from pme123/feature/orch-spec-patterns - see [Commit](git@github.com:pme123/orchescala/commit/ff0bdec639d8000a30c04dcf6fbfbcbd2ac71491)
- Orch Spec: patterns — reusable BPMN building blocks, chosen per element - see [Commit](git@github.com:pme123/orchescala/commit/c537b3fec4b6d7550832f65ea1d8468f70e41365)
- Orch Spec: Scala export groups interactions of separate blocks under a heading - see [Commit](git@github.com:pme123/orchescala/commit/3b3f78a737cbfb81605e97658a692739d3c5bee2)
- Orch Spec: step head names the separate block the step belongs to - see [Commit](git@github.com:pme123/orchescala/commit/b26d050d59683a0d2cef1faa66b8a25276be8dfb)
- Orch Spec: process list brackets each project group like the flow tree - see [Commit](git@github.com:pme123/orchescala/commit/3c10d757936f24888c0eb1a4cf02d489761d85d2)
- Orch Spec: data model brackets interactions of separate blocks; bpmn.io mark under dialogs - see [Commit](git@github.com:pme123/orchescala/commit/58425e3f0004fc8e7ec3a27aa0ef729627f9f699)
- Orch Spec: separate blocks bracketed in the exports too - see [Commit](git@github.com:pme123/orchescala/commit/dbf81ee6db4bd3737b82ba3b4e1305a0471de1ff)
- Orch Spec: flow tree brackets separate blocks with their own start - see [Commit](git@github.com:pme123/orchescala/commit/5cc3b12e69604871ee5cc986e76bc4b8bfc74f34)
- Orch Spec: vendor libraries in their own chunks; no chunk-size warning - see [Commit](git@github.com:pme123/orchescala/commit/fc490968b0dbb48e5599f6c68c300b2b6945343a)
- Orch Spec: start card offers the way back to the folder that was just open - see [Commit](git@github.com:pme123/orchescala/commit/4804ff01405694bf064deb62eb240eeee09dbb03)
- Orch Spec: project group titles back to grey - see [Commit](git@github.com:pme123/orchescala/commit/80b2f65b225d9beac58f865e25b59bf808d68f8d)
- Orch Spec: project group titles larger than the process titles - see [Commit](git@github.com:pme123/orchescala/commit/2ae0262dd8c21884ca798e43f4ad22da5f9fbe0a)
- Orch Spec: spell the company «z9nai» in the Entra admin guide - see [Commit](git@github.com:pme123/orchescala/commit/2f49a048295dd783f9d1d27c651729d25499745e)
- Orch Spec: config/ notice tells local from SharePoint, with reload and folder link - see [Commit](git@github.com:pme123/orchescala/commit/6e476e1302cf898e494af9e88bc940bdf47bd966)
- Orch Spec: wordmark with customer and breadcrumb in the header - see [Commit](git@github.com:pme123/orchescala/commit/bfcc640f23216a63f237c9c4dcea21a4070fd97c)
- Orch Spec: header tools in groups, folder chip, account chip with role - see [Commit](git@github.com:pme123/orchescala/commit/30bef47a2229ce75dbd94aa03007c8f58294b271)
- Orch Spec: setup and SharePoint dialogs on one shared dialog with live checks - see [Commit](git@github.com:pme123/orchescala/commit/17b161632b49ca066eff8d2b68cb73bce6801b23)
- Orch Spec: login card with Microsoft mark, checking chip, account and role chips when denied - see [Commit](git@github.com:pme123/orchescala/commit/b761c48a62db2a7bea63a5d7e88e7bd4dc21e3da)
- Orch Spec: one start card for all states; storage choice as two options - see [Commit](git@github.com:pme123/orchescala/commit/d7a7f90b79d844899fd42bb7e992d8ea6cdba712)
- Merge pull request #17 from pme123/feature/orch-spec-config-folder - see [Commit](git@github.com:pme123/orchescala/commit/27045f4d25617b61e560ac861a4b0fca92e5854c)
- Merge remote-tracking branch 'origin/develop' into feature/orch-spec-config-folder - see [Commit](git@github.com:pme123/orchescala/commit/e15c4015da6af5f6f094a6dca152cd5d32efa8cb)
- Orch Spec: catalog section with state row and kind chips - see [Commit](git@github.com:pme123/orchescala/commit/f71048c0b1bfc08759035212ad3ef065738ec91c)
- Orch Spec: no move button for model.json - moved by hand, the Admin only hints - see [Commit](git@github.com:pme123/orchescala/commit/f9a4534b6a61872b5f90dd61b3ac34c9d080eff6)
- Orch Spec: admin forms with switches, GUID check and placeholder chips - see [Commit](git@github.com:pme123/orchescala/commit/7ca3a377a5fe1e9ae8aadd1253d350de158ded0e)
- Orch Spec: master data in config/model.json, no URL bypass of the login - see [Commit](git@github.com:pme123/orchescala/commit/5766132ba43d9319df4ab3323bbb59739b8c480f)
- Orch Spec: admin view with status strip and section cards - see [Commit](git@github.com:pme123/orchescala/commit/ada5baaf7dde8f2d1a16dda8b332affbda7c1dfe)
- Orch Spec: comment panel resizable and overlaying when narrow; active spot tinted; comment chip in process list - see [Commit](git@github.com:pme123/orchescala/commit/1d505abd1211a1c60a8962528445572ece6d39b1)
- Orch Spec: comment overview with element chips and latest entry; active spot as path - see [Commit](git@github.com:pme123/orchescala/commit/a2691a2ae3a3b99db6f0334a5650f8a0b11be921)
- Orch Spec: comment threads as cards, resolved ones folded, shorter times - see [Commit](git@github.com:pme123/orchescala/commit/e87e11776aa15565cb450448f64ea4ffcdcec346)
- Merge remote-tracking branch 'origin/master' into develop - see [Commit](git@github.com:pme123/orchescala/commit/e41400b39955ad03b3cee3e6b2d64d15460b017a)
- Merge branch 'master' into develop - see [Commit](git@github.com:pme123/orchescala/commit/f9a0eef58136191f1b7db82dabab2e1fca596640)
- Merge pull request #16 from pme123/feature/orch-spec-comment-bubbles - see [Commit](git@github.com:pme123/orchescala/commit/11b23535c77f7b96b577d76b4a6472e2407f49e7)
- Merge origin/develop into feature/orch-spec-comment-bubbles - see [Commit](git@github.com:pme123/orchescala/commit/a821560a60315e7f3c0a79057cce5e628c456532)
- Orch Spec: no missing-required finding for user tasks and own workers - see [Commit](git@github.com:pme123/orchescala/commit/324ecad4cbe10be94385eff758242de818e8759a)
- Orch Spec: BPMN export keeps what is unchanged; section titles in text colour - see [Commit](git@github.com:pme123/orchescala/commit/9973562513cd13566b62c4ea6bb4b529039ad94d)
- Orch Spec: In and Out of a step as cards with their fields - see [Commit](git@github.com:pme123/orchescala/commit/aeb34ea33b6a12509eeabdd545cc4d7f41d50aba)
- Orch Spec: mapping rows show the expected type and what the FEEL delivers - see [Commit](git@github.com:pme123/orchescala/commit/5e8f82954b65c182301519bc3bd14cdbe25d7e50)
- Orch Spec: step panel sections fold with counts; outputs name new variables freely - see [Commit](git@github.com:pme123/orchescala/commit/2ec4372032c4834509e3300c235da5d502b1a853)
- Orch Spec: Entra and SharePoint setup guides incl. mentions and Teams notifications - see [Commit](git@github.com:pme123/orchescala/commit/6da67b271f75375ed57bbea33ece8a87be72180b)
- Orch Spec: resolve the Entra redirect URI and setup link against the document URL - see [Commit](git@github.com:pme123/orchescala/commit/9d7faa24d262bfceed7a01d4feb9d7970d544234)
- Orch Spec: step head with kind and object chips, findings listed on top; list index from JUEL counts from 1 - see [Commit](git@github.com:pme123/orchescala/commit/e1623c4817f2a97a7f4de085654b70ed935ed323)
- Orch Spec: @-mentions and Teams notifications for comments, blue frame around the active comment's element - see [Commit](git@github.com:pme123/orchescala/commit/90cb4dc7e835871ef084475f2e9380d103424002)
- Orch Spec: JUEL to FEEL covers the Camunda 7 runtime idioms - see [Commit](git@github.com:pme123/orchescala/commit/16a09b41ae88f3006fb8b054ab7404b15bb760d8)
- Orch Spec: process list grouped by project, with progress, engine, findings, search, filter and sorting - see [Commit](git@github.com:pme123/orchescala/commit/516d0a3f57ec89dcf76a12c3321f842bf82c0166)
- Orch Spec: comment bubbles at every spot, side panel with overview and stepping (like arch-review) - see [Commit](git@github.com:pme123/orchescala/commit/71a1f6345550cb73a71ce810eca06b0305fad2be)
- Orch Spec: "JUEL → FEEL" for specifications from an older state - see [Commit](git@github.com:pme123/orchescala/commit/d79afc17309ef2c5ce5388f2e696d17d6763682c)
- Orch Spec: findings filter and wider search in the flow head - see [Commit](git@github.com:pme123/orchescala/commit/d4d3be082eb3fb622febf2f755e11e136cfe879a)
- Orch Spec: branch heads as coloured chips with their FEEL condition; Spin and execution.getVariable translate to FEEL - see [Commit](git@github.com:pme123/orchescala/commit/46d94bbea7b305000c9023e723aeb3d41533fc89)
- Orch Spec: flow rows weighted by kind, with findings in the tree - see [Commit](git@github.com:pme123/orchescala/commit/fbdbf205ad39fa382f26dbfca4671ebba9b18438)
- Orch Spec: wider data model sidebar, centred editor; shared classes for a twice-thrown signal - see [Commit](git@github.com:pme123/orchescala/commit/50501438fb93d91e160cbbeca361cd8882510c8d)
- Orch Spec: no code column - the Scala preview folds out per type - see [Commit](git@github.com:pme123/orchescala/commit/6256d8e1d45a73fa0a1fd1b1e073ad8256c22ea8)
- Orch Spec: Scala preview highlighted, collapsed by default, descriptions once at the common defs - see [Commit](git@github.com:pme123/orchescala/commit/79d33ac683b429217acf8a1b5a093532b36fdade)
- Orch Spec: ADT editor with tinted common block, coloured case cards and "gemeinsam machen" - see [Commit](git@github.com:pme123/orchescala/commit/dfce208bc6e0942acdefa5aaca605879f6a549ae)
- Orch Spec: type chips in field rows, interactions grouped by kind - see [Commit](git@github.com:pme123/orchescala/commit/d8bf5a83fea04ab90824c6dc95080cc1ed9059a2)
- Orch Spec: data model sidebar shows what a type is and what it lacks - see [Commit](git@github.com:pme123/orchescala/commit/1f8725209332119e3fd12d81e0a481c6a0ac4da1)
- Orch Spec: import prepares interactions the domain does not know - see [Commit](git@github.com:pme123/orchescala/commit/24ab8ddd9c0ea102ad58c42895a5e1551127ca85)
- Orch Spec: import lifts fields shared by all enum cases to common fields - see [Commit](git@github.com:pme123/orchescala/commit/16a96b3765b64747c2d56f6e1ebfd73812c599c3)
- Orch Spec: a single enum case as a field type - see [Commit](git@github.com:pme123/orchescala/commit/c75f443b9ab7db7514fc5894fa11ccf1f07f70f9)
- Helper docs: the company project's own domain feeds the spec catalog first - see [Commit](git@github.com:pme123/orchescala/commit/d09a0da948ecf451c3f089bb9253af6bc18b1ed3)
- Orch Spec: one folder permission for all catalog projects - see [Commit](git@github.com:pme123/orchescala/commit/df29b2f0be31a237bf431cc2ef3cd4bd067ab10e)
- Orch Spec: prefer a fresh domain over a stale catalog, keep Object.In names - see [Commit](git@github.com:pme123/orchescala/commit/937ec9f447ad073cf9d20ae12c299f33e9a271f0)
- Orch Spec: Map fields and common fields of an ADT enum - see [Commit](git@github.com:pme123/orchescala/commit/2daed9a6629d5f816608d878c5d496bf5942f76d)
- Orch Spec: enums with fields per case (ADT) - in the type builder, the generator, the import and FEEL - see [Commit](git@github.com:pme123/orchescala/commit/2d0cbd44b562820aff0881e4ff432fc0a80b8e76)
- Orch Spec: "Aus BPMN" finds the domain by process id - see [Commit](git@github.com:pme123/orchescala/commit/828627797ad0d0cb713958e04c39ca8d4bdf100f)
- Orch Spec: import a whole project - folder or ZIP - with data model and interactions - see [Commit](git@github.com:pme123/orchescala/commit/d13aae6ed3390b8e94933b73e75747d5151abbd5)
- Orch Spec: type check against the domain catalog - see [Commit](git@github.com:pme123/orchescala/commit/53b9acff9a10849ea436685f472a034d2ec223b4)
- Orch Spec: BPMN import turns JUEL into FEEL - see [Commit](git@github.com:pme123/orchescala/commit/8caaa712575822d192c42592afe1b18cdf6784f2)
- Orch Spec: required input fields are marked and cannot be dropped - see [Commit](git@github.com:pme123/orchescala/commit/775a86ea057776830279a5bb5f0e70c8beec77c5)
- Orch Spec: FEEL for every engine - the export translates into the BPMN - see [Commit](git@github.com:pme123/orchescala/commit/3d8c4a6c84f1aba59a05a9a49ee142e596b8e6ac)
- Orch Spec: FEEL for output mappings against the service result - see [Commit](git@github.com:pme123/orchescala/commit/50dab527af129c5414897a094e5fa01e72bd0dfb)
- Orch Spec: FEEL expressions in mappings - checked while typing, with path completion - see [Commit](git@github.com:pme123/orchescala/commit/002c263fdd2ab91aa10d6ccf76b6a8f7982d17f5)
- Orch Spec: confirm before removing a mapping row - see [Commit](git@github.com:pme123/orchescala/commit/efae8d320f80fb0bc5a4f07afd227499fe8d84f3)
- Orch Spec: every mapping row can be removed - see [Commit](git@github.com:pme123/orchescala/commit/16f62dd35627012e0c0e1af825c21f0cc74f85ca)
- Orch Spec: mapping fields beyond the model are extensions, not errors - see [Commit](git@github.com:pme123/orchescala/commit/507a10d3459bf3a786ecc165ccf20b403ae06734)
- Orch Spec: flag duplicate names in a step's mappings - see [Commit](git@github.com:pme123/orchescala/commit/43d80b956b77e7841116bb085c8881ab9b4b02ad)
- Orch Spec: explain the mapping fields on hover - see [Commit](git@github.com:pme123/orchescala/commit/7c4a63c668ee532c560dc7cc9789fc4a3902b73a)
- Orch Spec: mapping rows keep the focus while typing the name - see [Commit](git@github.com:pme123/orchescala/commit/d9a66a1c3762089452780231a01605b0471dff20)
- Orch Spec: delete a specification from the list (admin only) - see [Commit](git@github.com:pme123/orchescala/commit/01fb4af4ffd0e62d476cab7539f0a750f6a6aff4)
- Worker: short job locks renewed while running, bounded parallel jobs, identity bound to the process - see [Commit](git@github.com:pme123/orchescala/commit/bfc1e9d1a5fe433da6ebe435cc371d409c2b61b4)
- Op worker: add JAXB to the dependencies - see [Commit](git@github.com:pme123/orchescala/commit/fdaedb18069fcb4bfd8c96273c9af94193050ef5)
- Docs login: verify the token in the docs cookie - see [Commit](git@github.com:pme123/orchescala/commit/10c72e788ba6a583eb30501a7c29f5d5ad506dac)
- Worker forwarding: no host from the request path (SSRF) - see [Commit](git@github.com:pme123/orchescala/commit/6a68a8f51995fd2624d7ca13934f9828d1752573)
- Op worker: read the retries only when handling a failure - see [Commit](git@github.com:pme123/orchescala/commit/d23aed079f789e3b896944593ff0598c07f69f47)
- Engine: remove a caller supplied _identityCorrelation - see [Commit](git@github.com:pme123/orchescala/commit/4a30e1d8a96f0c6795019e049548a40ef4cab9b6)
- PasswordGrantFlow: background refresher keyed like the token cache - see [Commit](git@github.com:pme123/orchescala/commit/f9c5e972770eaaca75f7c851b966f76b727e0afc)
- C7/Op engine calls: run on the blocking pool, with timeouts - see [Commit](git@github.com:pme123/orchescala/commit/75413e16676bebf5c4806994085e6477d1c66b3a)
- Company check: compile a generated company project in the build (sbt companyCheck) - see [Commit](git@github.com:pme123/orchescala/commit/6c71081213e4987d5fe18f7fe75f72b0baedd802)
- Company generator: templates follow the valiant-orchescala structure - see [Commit](git@github.com:pme123/orchescala/commit/20f861c1b88701ff7dc8b629cedd65ce595a887d)
- C8: startProcessByMessage signs the identity correlation - see [Commit](git@github.com:pme123/orchescala/commit/bc6f6ccacaf535b1a927065f0af11cc622a63e4c)
- GET /deployment without targetEngine lists the deployments of all engines - see [Commit](git@github.com:pme123/orchescala/commit/77ca8ca2bf79259a1f0e167102b003c484b43aed)
- C8Client: restAuth has no silent default, add C8DefaultNoAuthClient - see [Commit](git@github.com:pme123/orchescala/commit/4f352e89981a8c4864bb0df90a13c76b8fd319e3)
- C7/Op OAuth2 clients: use the current token on every call - see [Commit](git@github.com:pme123/orchescala/commit/fa33de112471777f2e56e75eb6a7c28523ff9213)
- Added Tokens to Simulations. - see [Commit](git@github.com:pme123/orchescala/commit/b2bba03f757f8bbd61eaf4cdc7cda6efe79084de)
- Worker app: verify Bearer tokens on /worker, trust several issuers (AnyOf) - see [Commit](git@github.com:pme123/orchescala/commit/1dbe699a8340c465f34ee3e3f18f03e5df43cff3)
- DeployHelper: keep the Postman API key out of the newman command - see [Commit](git@github.com:pme123/orchescala/commit/af411464f64a6ced13f61e097914717ba0e5f04b)
- Log token fingerprints instead of token fragments, no secrets in toString - see [Commit](git@github.com:pme123/orchescala/commit/e747d1f9cc4d41e7f2336fafdfae3d26ef24790c)
- Gateway: verify Bearer tokens as JWT (TokenValidation) - see [Commit](git@github.com:pme123/orchescala/commit/446665beabf3d9602c82150cad84561411e71afe)
- Remove the unused CamundaClient given from the CompanyC8Simulation template - see [Commit](git@github.com:pme123/orchescala/commit/f3e152674ca31513cb9fa3e50d12b08e7f3d9ccc)
- Raise connection limits of the shared sttp backend (200 / 100 per host) - see [Commit](git@github.com:pme123/orchescala/commit/d812ab010346500f84e8e66d6904854bab15dd6b)
- C8: UserTask.taskDefinitionKey is the user task's element id, like C7 - see [Commit](git@github.com:pme123/orchescala/commit/a497c4db58a41366d5998890f5ec1bcbbba49a8b)
- C8: engine services call the REST API v2 instead of the CamundaClient SDK - see [Commit](git@github.com:pme123/orchescala/commit/a7645320437dd8304a827fda7ed3d3be19a21737)
- C7/Op: run bearer token clients on one shared connection pool - see [Commit](git@github.com:pme123/orchescala/commit/801edb850a085b73976f97c14d2dd8de0b11691d)
- Fixed problem with get variables service filter in C8. - see [Commit](git@github.com:pme123/orchescala/commit/60364bbe0073349c624465ea5432116b7fb0efd8)
- Fixed leak in Clients for Token handling / added getDeployments. - see [Commit](git@github.com:pme123/orchescala/commit/f3c243679c1999ece7f22906491c35ded8fc1fe8)
- Added C8 deployment to DevHelper. - see [Commit](git@github.com:pme123/orchescala/commit/db925ceb4fc783130d10de1229cf1c0f848c6cd7)
- Adjusted configuration of C8 client. - see [Commit](git@github.com:pme123/orchescala/commit/ef79d3ccf6f26741e0fbddb9b162f922e8dbc20c)
- Adjusting datatypes of C8 classes to OffsetDateTime from String. - see [Commit](git@github.com:pme123/orchescala/commit/65bcbcf1a2e42aef1289342130b4fd97266d57f6)
- Added explanations to run local test BPMN engines. - see [Commit](git@github.com:pme123/orchescala/commit/2e171ec7844718c7a05812ab08d4915b8213c96f)
- Fixing ignored errors in logs. - see [Commit](git@github.com:pme123/orchescala/commit/cee38552dd5167daf5cb48ffcaecfde46917578e)
- Merge branch 'develop' - see [Commit](git@github.com:pme123/orchescala/commit/fdef3c3fb28e1c79c193e375d122106c669f73e3)

## 0.7.1 - 2026-09-10
### Changed 
- Adjustments to run company-orchescala. - see [Commit](git@github.com:pme123/orchescala/commit/979e36d16000d390d2441d5b35bae2f114aef747)
- Supporting multiple deployments for different engines. - see [Commit](git@github.com:pme123/orchescala/commit/dc33c7bc2969eb4a5450eed922ab8ff3294debf6)
- Running example with all engine implementations. - see [Commit](git@github.com:pme123/orchescala/commit/4ae4a35843bacd09f647361eae5c7fe3923ae75d)
- Added coursier to resolve dependency - working c7 deployement with postman. - see [Commit](git@github.com:pme123/orchescala/commit/0fe70c8929556c31cc30fa1f4d3e58fab98f8d3c)
- Added REST endpoint for deploy with manifest method. - see [Commit](git@github.com:pme123/orchescala/commit/15862698153a34152d6e58f7f978d726c5e001e2)
- Added deploy with manifest method for the different engines. - see [Commit](git@github.com:pme123/orchescala/commit/892c8090c051efb4f73a1ddce747300288364337)
- Added deploy method for the different engines. - see [Commit](git@github.com:pme123/orchescala/commit/e9b536e4fe83a0167af09605668ae25b9ad8c567)
- Removed specific GatewayGenerator - is not used anymore - standard module in company-orchescala projects. - see [Commit](git@github.com:pme123/orchescala/commit/743190ad1584456bff813a71b4a654a39d5147a6)
- Adjusted order when publish new version to get faster (no downloads if not needed). - see [Commit](git@github.com:pme123/orchescala/commit/0755a1ec0d91467afce877d7007248040fb6f3e5)
- Fixed: Removed own Project in dependency references in orch-docs. - see [Commit](git@github.com:pme123/orchescala/commit/c4693f17eeedd8f19857e6488737c2a1d548f505)
- Added search field for topics / processNames in top navigation fo orch-docs. - see [Commit](git@github.com:pme123/orchescala/commit/36773a7be580325969e500ada3b17a5043d5eee9)
- Added different license for docs/specs. - see [Commit](git@github.com:pme123/orchescala/commit/6191f391ae4544d00678cd90fae5ac2502c36d63)

## 0.7.0 - 2026-09-03
### Changed 
- Integrated orch-spec into orchescala (part of orch-docs). - see [Commit](git@github.com:pme123/orchescala/commit/a0fdad14b1d6e44f9c2e6544bdeb098a39791948)
- Integrated orch-docs into orchescala. - see [Commit](git@github.com:pme123/orchescala/commit/64a99720476953eaad4ca9c735b753386a42ab30)
- Removed old laika documentation for projects. - see [Commit](git@github.com:pme123/orchescala/commit/d40edc291ddf58b3c4471851a244a1c0b3b369f2)
- Updates for new documentation and improvements. - see [Commit](git@github.com:pme123/orchescala/commit/bb7d436e7fb1c1e198779ddc6a9e67da53671cf6)

## 0.6.3 - 2026-09-01
### Changed 
- Pushed it to new docs preview. - see [Commit](git@github.com:pme123/orchescala/commit/0e802efb32e421d9ae6e51cc5f9cc89b543e73e9)
- Fixed publish in projects upload WebDAV. - see [Commit](git@github.com:pme123/orchescala/commit/036d607de9d547b755597e0cabd00859c72db674)

## 0.6.2 - 2026-08-26
### Changed 
- Fixed not stopping sbt test clean / fixed warning in build.sbt. - see [Commit](git@github.com:pme123/orchescala/commit/873685c824167cb515c1d6e1277d0de083bb585e)
- Adjusted calcRetries to lowerCase in doRetryMsgs / logged after -befor just info for cases like timeouterrors. - see [Commit](git@github.com:pme123/orchescala/commit/7a8cc36a71197426bdc879b6be8e27b062a6a24f)
- Added new documentation using orch-doc. - see [Commit](git@github.com:pme123/orchescala/commit/e6c5ac694871a1574ef55213230b62a6bc6d97ca)
- Activated doRetryMsgs for calculating retries of completion of an external task. - see [Commit](git@github.com:pme123/orchescala/commit/6f02a4f7071305d3dd062688f737fda71c4f8578)
- Activated doRetryMsgs for calculating retries of completion of an external task. - see [Commit](git@github.com:pme123/orchescala/commit/265e8a6836f57e2b31780ff552aa08a82b3b395c)

## 0.6.1 - 2026-08-19
### Changed 
- Added fallback for optional input column label and output column name. - see [Commit](git@github.com:pme123/orchescala/commit/de13e7421834d6defb3412da0e30b9e85cf6326d)
- Fixing broken ci pipeline. - see [Commit](git@github.com:pme123/orchescala/commit/42e7de608aaf0d2b267f3b3ec00c7bc483a23cbb)
- Added case classes to DMN Inputs. - see [Commit](git@github.com:pme123/orchescala/commit/91ba95b69cf24b37ad7d2d624c2234de39bbcf45)
- Removed redundancies in DmnTester. - see [Commit](git@github.com:pme123/orchescala/commit/c37f60c94a03c48a2777f172cd6d5dd26c6929f5)
- feat(dmntester)!: DMN paths are relative path strings - see [Commit](git@github.com:pme123/orchescala/commit/894077e963fc9996084179918a021fc06b86e90a)
- refactor(dmntester): a config names its DMN exactly once - see [Commit](git@github.com:pme123/orchescala/commit/7a0bde7f2968415acc47f89bef002c2c05cd33d7)

## 0.6.0 - 2026-08-18
### Changed 
- Added filter to remove title for enums to show correct enum values. - see [Commit](git@github.com:pme123/orchescala/commit/3d1d17001cbad2fb03fbbad6707e9d0b5c7f3aa3)
- Merge pull request #15 from pme123/feature/dmn-tester-integration - see [Commit](git@github.com:pme123/orchescala/commit/e2a596f8f6ebc4e9ce7f56112ab983ccc0ae51d8)
- fix(ci): link the Scala.js UI with sbt instead of asking sbt from vite - see [Commit](git@github.com:pme123/orchescala/commit/176cb106456a7683536b61ac27c4c6a8d85c941f)
- Added dmntester to orchescala. - see [Commit](git@github.com:pme123/orchescala/commit/4e8d91f8383886f8945609775e7f5a33d4f18fd3)
- Added reference also as def. - see [Commit](git@github.com:pme123/orchescala/commit/4a50ab2761c95d5da845f65282fc80a9814609dc)

## 0.5.19 - 2026-08-17
### Changed 
- Added parallel execution to speed up time. - see [Commit](git@github.com:pme123/orchescala/commit/88ac99b8b4c18e776e03507fc3d3c70219b0169f)

## 0.5.18 - 2026-08-17
### Changed 
- Added References to Composed Workers. - see [Commit](git@github.com:pme123/orchescala/commit/89f12c0544bfa3886e8d4477fae605f9bc02f2ea)
- Added redirect index.html to WebDAV upload. - see [Commit](git@github.com:pme123/orchescala/commit/172ab086ed229d68c6362cb477f64187d73f0733)

## 0.5.17 - 2026-08-05
### Changed 
- Changed variables of UserTask to use the UserTaskService instead of ProcessInstanceService. - see [Commit](git@github.com:pme123/orchescala/commit/670f4a13d093fe84b1c87c1163664f1b4d3597e5)
- Added .gitlab configuration to CompanyGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/ed67a625f0a1ac92e6e382cea13765e8d2200645)

## 0.5.16 - 2026-07-31
### Changed 
- Added toCurl if the response from service is not 2**. - see [Commit](git@github.com:pme123/orchescala/commit/6833ce2e3245df9d7693fb5ebddfbb97b757ab59)
- Adjusted gitlab action due to Error in container build: exit code: 137, reason: 'OOMKilled' in GenericFileGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/307f6f4b8ec6b8a0d61a97f37c68fcd951f996b9)

## 0.5.15 - 2026-07-28
### Changed 
- Adjusted gitlab action due to 419 error in GenericFileGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/66849245d0aff4fbb4461cd4c68263951ebd9b3b)

## 0.5.14 - 2026-07-27
### Changed 
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](git@github.com:pme123/orchescala/commit/2262cc47816de77b547e77fff6b01c3393f373df)
- Merge pull request #14 from pme123/stale-worker-problem - see [Commit](git@github.com:pme123/orchescala/commit/df4eb23dc06199cd749587d5b3b899ef3296d681)
- Fixes for pull request. - see [Commit](git@github.com:pme123/orchescala/commit/54e892c2ed6f3b1264ab59e2a599c9abcee1f846)
- Try fixing stale Workers. - see [Commit](git@github.com:pme123/orchescala/commit/820e3ded317535ec08079a07b0b34e6c02cff2cb)
- Try fixing stale Workers. - see [Commit](git@github.com:pme123/orchescala/commit/08fe5fd6234d2f6bbd50e248afc653c132960f7a)
- Fixed UserTask summmary for PostmanApiCreator. - see [Commit](git@github.com:pme123/orchescala/commit/9b92dd7bf85af7516e0d7be0b3133c09a57bdfbe)
- Added /site to references. - see [Commit](git@github.com:pme123/orchescala/commit/32ddba5740680a89a16253e7ed7d54c62a9b079d)
- Fixed initWorkerFromService - to only validate input message. - see [Commit](git@github.com:pme123/orchescala/commit/5713c5602f1004018320ca761e20d5f52bb55213)

## 0.5.13 - 2026-07-10
### Changed 
- Fixed differences in bpmn generation of ModelerTemplUpdater (adding color). - see [Commit](git@github.com:pme123/orchescala/commit/9f6c526b4aa527dd152f4043845346ffa0abd1ac)

## 0.5.12 - 2026-07-10
### Changed 
- Fixed possible Connection pool leak in C7WorkerClient. - see [Commit](git@github.com:pme123/orchescala/commit/d439296c13884505b9085b43a99857f479e5ada8)

## 0.5.11 - 2026-06-02
### Changed 
- Added way to set default Retries as a function that only does more retries if it is a ServiceError for C7Worker. - see [Commit](git@github.com:pme123/orchescala/commit/f4c75e4ff02ef478530a6a273a531d0fd6902f5b)

## 0.5.10 - 2026-06-01
### Changed 
- Added way to set default Retries for C7Worker. - see [Commit](git@github.com:pme123/orchescala/commit/c8e733b6d8781c27d092fec2eb02dc4932f1c259)
- Merge remote-tracking branch 'origin/develop' into develop - see [Commit](git@github.com:pme123/orchescala/commit/bdb23ec36ee2e9df824898a20c6f99fdb8934667)
- Updated TestApiCreator example. - see [Commit](git@github.com:pme123/orchescala/commit/0507de4b47859730951964318710dd4afd3ebc7b)

## 0.5.9 - 2026-05-27
### Changed 
- Fixes not recovering from failure, in claiming tasks ind C7WorkerClient. - see [Commit](git@github.com:pme123/orchescala/commit/3093ecfbb37f919ea710d91bd6c2ff76be0198f2)
- Updated patched version updates. - see [Commit](git@github.com:pme123/orchescala/commit/cff8f45fdef48228fca7e1c940cc61d3cdb3c8c5)
- Logs error with every retry not just the last. - see [Commit](git@github.com:pme123/orchescala/commit/da6c6f1d9d5ec0678ef997c133bd3574cedc5276)

## 0.5.8 - 2026-05-06
### Changed 
- Merge pull request #13 from pme123/feature/add_idempotency - see [Commit](git@github.com:pme123/orchescala/commit/4c364cbeb85a37fa61036758347be58b00cc4078)
- Changed AnyRef to Product in idempotentIdToUUID. - see [Commit](git@github.com:pme123/orchescala/commit/3943f39156c7dfd0ccc958dd43af7ca570d2a017)
- Added idempotency to other engines. - see [Commit](git@github.com:pme123/orchescala/commit/0c18569c339b39d5bdc407833f6108fb34b39e14)
- Removed TODO in verifySnapshot. - see [Commit](git@github.com:pme123/orchescala/commit/8524cb081115aee23190e7d0656489db35552cb5)
- Added _idempotency to GeneralVariables. - see [Commit](git@github.com:pme123/orchescala/commit/4e10a1d6eca9adbcd1ded1348ff2f8a9f42f851a)
- Fixed missing day in generated lockback configs. - see [Commit](git@github.com:pme123/orchescala/commit/6686e374eb7c90391765d58c1a07ec8d48479b27)
- Fixed missing escape $ in pipeline config. - see [Commit](git@github.com:pme123/orchescala/commit/bc4f1d4de692a80155fdef2c456cf1bf2fac636a)
- Adjustments in pipeline config. - see [Commit](git@github.com:pme123/orchescala/commit/4ffbb15411b05999c819da4d76567a2469b8cca2)

## 0.5.7 - 2026-04-07
### Changed 
- Changed symlinks to relative path that it works for other developers. - see [Commit](git@github.com:pme123/orchescala/commit/22064b11e32211347f901b871280791da78b13d2)

## 0.5.6 - 2026-04-07
### Changed 
- Adjusted PipelineConfig after KI review made standard default. - see [Commit](git@github.com:pme123/orchescala/commit/f38e2eb736707f19d70e0d2fe4e781b277049c8e)
- Optional adding diagrams folder if exists. - see [Commit](git@github.com:pme123/orchescala/commit/24b1b8cfc14c7066b9873ef5dbbe6c1fa1123c97)
- Fixed docker for gateway if no gateway is configured. - see [Commit](git@github.com:pme123/orchescala/commit/0fcabe33bcc0c0d87dedfdd4161be4e43f4678be)

## 0.5.5 - 2026-04-06
### Changed 
- Fixed bad publish action. - see [Commit](git@github.com:pme123/orchescala/commit/732a5a7807cf6435f8fa39f0b5a61624c273fc29)

## 0.5.4 - 2026-04-06
### Changed 
- Merge pull request #11 from pme123/feature/gitlab-pipeline - see [Commit](git@github.com:pme123/orchescala/commit/f8eab66a1af89e7b3d541b996001695c4e3e3dd2)
- Fixes in gitlab Pipeline. - see [Commit](git@github.com:pme123/orchescala/commit/4cd880c3f4f09061f8c04560b321610a4b87f105)
- Merge branch 'develop' into feature/gitlab-pipeline - see [Commit](git@github.com:pme123/orchescala/commit/b77e7f540c31ca6d5d56e39099749cc701a1ea0e)

## 0.5.3 - 2026-04-02
### Changed 
- Used error.toString to get more error information in Cockpit. - see [Commit](git@github.com:pme123/orchescala/commit/8a6316e1e57b2ebd04916ed9d74ed9ede4666629)
- Added debug info in OpenApiRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/f1105c5198163373ee85ab3d13e4cbb4c66f4025)
- Fixed customer data in log - now only if set to debug mode - the content of the request is shown. - see [Commit](git@github.com:pme123/orchescala/commit/26bd6c784e79c3e28d9f517530b1dfdb3485fed4)
- Fixed bad links in Gateway. - see [Commit](git@github.com:pme123/orchescala/commit/1083d6dedaccdf0999b3e6810b01ab4ab3591864)
- Moved api Configs in company directory. - see [Commit](git@github.com:pme123/orchescala/commit/dfac5e1011dd622817913e80d2e8f5feac3cb8d1)
- Adding pullOtherProjects for documentation / adjusted WebDAV. - see [Commit](git@github.com:pme123/orchescala/commit/c2218ac6da8da723e4c5a3f4b0fc1dfa0db3605c)
- Adding dependeny company projects. - see [Commit](git@github.com:pme123/orchescala/commit/1fe2aff616df4a1b5122169971e5784b155e3e32)
- Adjustments to create docs. - see [Commit](git@github.com:pme123/orchescala/commit/f594b78f4c4f8e9f3d3f0a20bb64eb1736601861)
- Fixed auto forwarding / to /index.html. - see [Commit](git@github.com:pme123/orchescala/commit/dffb20b5a1ff7930fb4c84a6510f4116705b37b2)
- Working version showing documentation in gateway. - see [Commit](git@github.com:pme123/orchescala/commit/caf1dc8850cca96fa1b875a2538fe041edb3953b)
- Working OAuth login for documentation. - see [Commit](git@github.com:pme123/orchescala/commit/ab5ffe1b73312816fd2b039b6fd1beada36ddb06)
- Added worker apiDocs diagrams forwarding to gateway. - see [Commit](git@github.com:pme123/orchescala/commit/589adad8d8897134f502979d43afb43f70649bab)
- Added worker apiDocs forwarding to gateway. - see [Commit](git@github.com:pme123/orchescala/commit/d4b28e2f5d1524f60461f5fc21218d1e3ed3e886)
- Added diagrams and OpenApi.yml to OpenApiRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/9db942a0aa195b2cb5fab031712e328b3d111bc8)
- Adjusted OpenApiRoutes - updated company creation. - see [Commit](git@github.com:pme123/orchescala/commit/16fafa7cdd544b56f77970ed766552f3c4110bd5)
- Fixed bad link in onboarding. - see [Commit](git@github.com:pme123/orchescala/commit/d9433041eaeea2c54eec8cfa87c6ab289744305d)
- Adjusted onboarding.md documentation / added script to setup existing file structure. - see [Commit](git@github.com:pme123/orchescala/commit/9ab2786e15fc119dde0269d276a42098c2dd4ab6)
- Adjusted onboarding.md documentation / added script to setup existing file structure. - see [Commit](git@github.com:pme123/orchescala/commit/2efec62ebd1fc3d7e7d768c9ebdb0ade507dc2bc)
- Added onboarding to onboard a member to the team. - see [Commit](git@github.com:pme123/orchescala/commit/4928c38c97dae8f77bc356165475cbe9c88cdf7d)
- Added check for completing UserTask if encoding of Out does not work. - see [Commit](git@github.com:pme123/orchescala/commit/3337600aa2328cc3878d4737bc95ec5e548b1cb5)
- Fixed Error Handling - so the gateway forwards the correct HTTP status. - see [Commit](git@github.com:pme123/orchescala/commit/3cd9d0ac929ed6a8912345bf3014cb00d56b6b2c)
- Added Documentation for Engine support. - see [Commit](git@github.com:pme123/orchescala/commit/02e395b94d9c925dc8052cb09868dc1cb7da2a8e)

## 0.5.2 - 2026-03-02
### Changed 
- Fix in default DevConfig - for generating build.sbt. - see [Commit](git@github.com:pme123/orchescala/commit/bebc3fcaaac500bf930c046e3500e767c8f9a8af)
- Merge pull request #7 from pme123/add-operaton-engine-support - see [Commit](git@github.com:pme123/orchescala/commit/5117182649495d5f8f7947474fe6743b9a84b9bf)
- Logging less of the token. - see [Commit](git@github.com:pme123/orchescala/commit/49cc021ec1dda05bb09b2c50b0ed3ad2399d0a32)
- Updated Gateway Docs. - see [Commit](git@github.com:pme123/orchescala/commit/566879ed2d4fe2766390134024b2487bf117adf7)
- Fixed pool shut down in OpClient. - see [Commit](git@github.com:pme123/orchescala/commit/689c3aeaa4e75d5be77bbb31183898fbb3a9f499)
- Renamed Operaton to Op. - see [Commit](git@github.com:pme123/orchescala/commit/00d741e107ed30a58da059d9e5f8dba3e9da1704)
- Renamed Operaton to Op. - see [Commit](git@github.com:pme123/orchescala/commit/53a8ed4a771250419edded6ee989d48c4e2841ea)
- Fixes in simulation missing _identityCorrelation. - see [Commit](git@github.com:pme123/orchescala/commit/52bee95bd91946f59e2e3df4b2285cc472e892f7)
- Fixes in simulation / _identityCorrelation. - see [Commit](git@github.com:pme123/orchescala/commit/d4da1b0c6e0776207e9cdd082956ca2ab79fc1e3)
- Merge branch 'develop' into add-operaton-engine-support - see [Commit](git@github.com:pme123/orchescala/commit/adb48dfdf95bbbba842cc379d1e9e08bbb62a036)

## 0.5.1 - 2026-02-27
### Changed 
- Increased MaxConnectionsPerHost from 10 to 25. - see [Commit](git@github.com:pme123/orchescala/commit/9701e8fcf4a830b671c095b9385e831b52d742b4)

## 0.5.0 - 2026-02-26
### Changed 
- Merge pull request #8 from pme123/fix-problem-simulation - see [Commit](git@github.com:pme123/orchescala/commit/92ab640a7b02b5b9bbc8afc0c03c672295a14875)
- Cleanup Resource finalizers. - see [Commit](git@github.com:pme123/orchescala/commit/7a902ee5891f04e2c5170d1ce358e3c7b06c2f95)
- Fixed problem of not running the failureHandling at all. - see [Commit](git@github.com:pme123/orchescala/commit/d4ff5826d1803276e9cb8e5c89e90ebd0f5589dc)
- Fixed compile problems added EnvironmentDetector for generice workerapp forward url. - see [Commit](git@github.com:pme123/orchescala/commit/23076a55b0820cb2a410fe4eb46c0a4f34eded2e)
- Merge branch 'develop' into fix-problem-simulation - see [Commit](git@github.com:pme123/orchescala/commit/c3b736d7148f09da9df1e5ea96afd8d12c891e5a)
- Fixed retry behavior in case of a failure in C7Worker. - see [Commit](git@github.com:pme123/orchescala/commit/bd0ba8447c55dd9e2e7d0218efa263149eeeea50)
- Changed workerAppUrl to variable. - see [Commit](git@github.com:pme123/orchescala/commit/88f9c66cff4d23558371f9f55dbfdc84bb7f44a3)
- Cleanup forward to worker logic in ProcessInstanceRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/58a96a4b06ea2ad6fb6defa6d5950a59c485cb1d)
- Cleanup client/engine creation for GatewayServer. - see [Commit](git@github.com:pme123/orchescala/commit/96289b759636d74cb171b7037b190bd00b28a65d)
- Removed engineConnectionManagerFinalizer. - see [Commit](git@github.com:pme123/orchescala/commit/9012b768c09d68e99298f38b9a7cda2e06a4bbf2)
- Working version without closing finalizer - see [Commit](git@github.com:pme123/orchescala/commit/c5ea71634ac8cec25e8acdfef2577cce354698b4)
- Added logging for finalizer creation - see [Commit](git@github.com:pme123/orchescala/commit/d6f0c575d6d0da160905c132571ebdc49301f7e9)
- Simulations working. - see [Commit](git@github.com:pme123/orchescala/commit/c64db9cfc0c43403bf3e3f403e4c8c0571807856)
- Only bootstrap in Apps. - see [Commit](git@github.com:pme123/orchescala/commit/3df25e8156ffe13e8d300fbd381f7d7fafb36996)
- Added logging in bootstrap in WorkerApp. - see [Commit](git@github.com:pme123/orchescala/commit/fb42c3462fc6fab0d6de74dea2026653f7244b50)
- Cleanup Routes - see [Commit](git@github.com:pme123/orchescala/commit/456359a018f01915b01b4b59f5b38a64318d9b12)
- Fixed problem with logging format. - see [Commit](git@github.com:pme123/orchescala/commit/202945e3da36e1edf2f2cc96b4dfde6787bfc8a5)
- Adjustments after deploying Gateway to Openshift. - see [Commit](git@github.com:pme123/orchescala/commit/0f91f5577c389c18014509f81d794a6612504850)
- Cosmetics logs comments. - see [Commit](git@github.com:pme123/orchescala/commit/b10956a74fef1a311e1a44c8ad872ecc6ad1e0d0)
- Added check before forwarding initProcess. - see [Commit](git@github.com:pme123/orchescala/commit/5aa3c941f9a1003831892474ac8570f38fef2c44)
- Removed helper from standard projectModules. - see [Commit](git@github.com:pme123/orchescala/commit/239fcd6432672074474219a0f2316eb48a806313)
- Added mermaid support in Api documentations. - see [Commit](git@github.com:pme123/orchescala/commit/520d36fb04b0640870a1be5d2ffea610572756e9)
- Removed Helper from modules, as it is only needed by service packages. - see [Commit](git@github.com:pme123/orchescala/commit/8b2d5ecedd8724687286e7e14d329970f7477f84)
- Fixed compile error in tests. - see [Commit](git@github.com:pme123/orchescala/commit/a8521e0132e88af47aab541d9989877ac7fd68d3)
- Updated Plugin versions in SbtGenerators. - see [Commit](git@github.com:pme123/orchescala/commit/0931453fc304b7afdb98dd117dc4b07bc4dc790f)

## 0.4.0 - 2026-02-04
### Changed 
- Fixed bad deserialization in C7HistoricVariableService. - see [Commit](git@github.com:pme123/orchescala/commit/dab527fdd9a6b4f5b1775cc39db60660f9237f35)
- Fixed deprecated App inheritance with main def. - see [Commit](git@github.com:pme123/orchescala/commit/ec5ddfdbc5e5be4d65b4b8bc4e53b954bf2a3da8)
- Fixed bad encoding in Camunda Vars. - see [Commit](git@github.com:pme123/orchescala/commit/072db233ccf81aa4e7b3ab0c9e17589c6ba77a15)
- Removed deprecations where possible. - see [Commit](git@github.com:pme123/orchescala/commit/85c2992e8c246025dc64ff7a07cca4a582b3661d)
- Changed C7 Services to queries where possible. - see [Commit](git@github.com:pme123/orchescala/commit/738c00acd6cb6408dc5c212765407870d850c97d)
- Updated dependencies. - see [Commit](git@github.com:pme123/orchescala/commit/87fc5b917459ff092a9f42db2959f440afbd9d5a)
- Adjusted scalacOptions in SbtSettingsGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/ae02aa938fea220d836151de0eab3acba2573fa6)

## 0.3.4 - 2026-02-02
### Changed 
- Fixed double diagrams in apiDescription for processes. - see [Commit](git@github.com:pme123/orchescala/commit/8ad4a1b7e6569234be3ca44946f707a7182336ad)

## 0.3.3 - 2026-01-30
### Changed 
- Merge pull request #6 from pme123/feature/worker-endpoint - see [Commit](git@github.com:pme123/orchescala/commit/eeabff376290700564b3e0d023477c895456adee)
- Small adjustment in DefaultEngineContext. - see [Commit](git@github.com:pme123/orchescala/commit/25fc610992060932c5a7f39df2c2e5eb1902e99b)
- Fixed bad Error handling in ProcessInstanceRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/5976603d11c28a587f68498c4b35b7f0a55af05c)
- Cleanup running InitWorker from WorkerRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/80070a65b27b4d66c899b3ce05388587715b92f6)
- Added tenantId in C7MessageService. - see [Commit](git@github.com:pme123/orchescala/commit/7b223460dfb1fa61fbd843f60a6fbeac29498958)
- Adjusted gateway dependecy to worker. - see [Commit](git@github.com:pme123/orchescala/commit/6f4fa7711e3ca376b8b30a168d530956c03f909d)
- Adjustments running Worker from WorkerRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/b71823d6e797096d2e8aeb3b049e6e3e702a8d16)
- Fixed timing side channels in IdentityCorrelationSigner. - see [Commit](git@github.com:pme123/orchescala/commit/081044ef4bcfeb11a5ccca0311911fdf365545a8)
- Fixed bad foldLeft in WorkerForwardUtil. - see [Commit](git@github.com:pme123/orchescala/commit/3eeaa93ded23fb77541fe408b727e4dbc10b88f9)
- Added types in C7WorkerClient. - see [Commit](git@github.com:pme123/orchescala/commit/224ed427a3c1509cf887cac4fe5ee4227f84c9b6)
- Cleanup IdentityVerification. - see [Commit](git@github.com:pme123/orchescala/commit/d6fb01c65510d91d4cc7e264dc2a9e152d85ffdb)
- Added documentation for gateway. - see [Commit](git@github.com:pme123/orchescala/commit/a9c655a0f7c49cf2d6739e77b6131460bd0a0bb7)
- Changed general variables to _. - see [Commit](git@github.com:pme123/orchescala/commit/12aaba76e72f074c52de03548f0b0f19484c916f)
- Changed documentation general variables to _. - see [Commit](git@github.com:pme123/orchescala/commit/393515d7205fd0db30a83d3be4540371f16e53a0)
- Added example for IdentityCorrelation. - see [Commit](git@github.com:pme123/orchescala/commit/ece4fbf8dfb95d8cf65acf5fcb37dd9dc7b7f0ee)
- Cleanup C7WorkerClient configuration. - see [Commit](git@github.com:pme123/orchescala/commit/261dd30b470ff35dca3da5cfd687623ff08f4d0a)
- Fixed WorkerTestApp generation / outputVariables in TemplateGenerator / added context to InitProcessZIOOutput / used retries from Camunda in C7Worker. - see [Commit](git@github.com:pme123/orchescala/commit/3843dd88dc6e1d63b52349920741dc08c709b554)
- Fixed Error in extractGeneralVariables. - see [Commit](git@github.com:pme123/orchescala/commit/ac95ef93673af51a5b53b3b7fe3437d357214827)
- Added maximum parallelism adjusted configs. - see [Commit](git@github.com:pme123/orchescala/commit/7de6e0486dbe085effaffef994e58a9d83633a09)
- Working version for using initProcess also from the simulations. - see [Commit](git@github.com:pme123/orchescala/commit/a122f6876c9564043320f02337ddcf89ce6d5413)
- Clean up and alignment of Api-/Gateway-paths. - see [Commit](git@github.com:pme123/orchescala/commit/82cd817327c4b1c9ca644b3cc37d5bd9c66d07a2)
- Changed all GeneralVariables to optional to minimize process variables. - see [Commit](git@github.com:pme123/orchescala/commit/35008a6c68f2be858b166a074908b9dcfaf63881)
- Added generalVariables to initFunction. - see [Commit](git@github.com:pme123/orchescala/commit/877371d2c806b4c9400d894de9ec0ea2208b239a)
- Fixed startProcess with new initializedInput. - see [Commit](git@github.com:pme123/orchescala/commit/784272065b03386e9b6389ae2fb33ab3c78a874b)
- Removed inConfig. - see [Commit](git@github.com:pme123/orchescala/commit/1e96627a06b5357018567a9fb084ff17e20e5cf1)
- Added mocking and inConfig in runWorkFromServiceWithMocking. - see [Commit](git@github.com:pme123/orchescala/commit/90268a5f45695c452d9f3b2c7907d81a58a9b6a6)
- Cleanup Endpoint definitions. - see [Commit](git@github.com:pme123/orchescala/commit/9b7d4b596de27ca66d45654fbcf55269f581cf06)
- Fixed Simulations with C7 and C8 - start with Message. - see [Commit](git@github.com:pme123/orchescala/commit/9cef850987eb395b4aff3f632efa0aa1d8673f52)
- Adjusted Error Handling in WorkerRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/81c5eedbe65e34dfdc7e34992262573defb58fc9)
- Split the Routes to specific routes in Gateway. - see [Commit](git@github.com:pme123/orchescala/commit/47a7a4a1073553a51da725515ae8b80ae1590e42)
- Merge branch 'develop' into feature/worker-endpoint - see [Commit](git@github.com:pme123/orchescala/commit/925240115c7cd2e603eabb9cbc7608dcad49d319)
- Fix: handle error in setCorrelationVariable if the process is only 'short lived'. - see [Commit](git@github.com:pme123/orchescala/commit/aa49565c9c9f1cc539f9680131ef781b0cb86123)

## 0.3.2 - 2026-01-08
### Changed 
- Fixed bad variable name filters in WorkerRegistries. - see [Commit](git@github.com:pme123/orchescala/commit/fe156b65f243cf26f32725c32efd4d78713449f7)

## 0.3.1 - 2026-01-05
### Changed 
- Fixes for Demo setup new project. - see [Commit](git@github.com:pme123/orchescala/commit/a1ffba8cc3cc07901eb084b4a1f07bdc781fab11)

## 0.3.0 - 2025-12-19
### Changed 
- Merge pull request #5 from pme123/feature/moduleType - see [Commit](git@github.com:pme123/orchescala/commit/7cee161976e392b14332d67f5d27440f5c50f7f4)
- Fixed pull request comments. - see [Commit](git@github.com:pme123/orchescala/commit/4ec0f522594a43a0b93bb32d57b4cb79d4478300)
- Added ModuleType to the ApiProjectConfig, so you can have different project layouts (service only). - see [Commit](git@github.com:pme123/orchescala/commit/fa16c27849b6fde662bd55bab35cd9dea291dd14)
- Merge pull request #4 from pme123/feature/changedVariablesToJson - see [Commit](git@github.com:pme123/orchescala/commit/1f43c088e1a7f9eb1bfe2ad3d5f039e90195bd9d)
- Fixing Pull Request comments. - see [Commit](git@github.com:pme123/orchescala/commit/db7b258a9f91ca52d70188b1d4604435d9775e1a)
- Fixing Pull Request comments. - see [Commit](git@github.com:pme123/orchescala/commit/fa35fa618a9e7f0405e4529d1808a57d954a7fa3)
- Cleanup WorkerHandler. - see [Commit](git@github.com:pme123/orchescala/commit/8beef3dca886b28df256ef039ce7f340b1e36758)
- Changed C8 Camunda API calls to async. - see [Commit](git@github.com:pme123/orchescala/commit/222e3fb1396bf6afcf7c6d13957db039a0f6a302)
- Changed variables to JsonObject from CamundaVariables in Engine Services. - see [Commit](git@github.com:pme123/orchescala/commit/45b46bd6de8b21eb491d195872450ffc7c282ec1)
- Fixing identity correlation problem - not working. - see [Commit](git@github.com:pme123/orchescala/commit/8ce1a602ac7dea7a95f47b6a7af2bd310191a846)
- Fixed naming to sso. - see [Commit](git@github.com:pme123/orchescala/commit/f7de24a57172e0614f2494914dc8780d8f9a99c4)

## 0.2.31 - 2025-12-06
### Changed 
- Added ProcessInstanceEndpoints.startProcessByMessage. - see [Commit](git@github.com:pme123/orchescala/commit/33f3150f76f2d7c5ce6100f5ce23f6a57ab73cb6)

## 0.2.30 - 2025-12-06
### Changed 
- Added EngineConfig to EngineContext to verify signature in ServiceHandler only. - see [Commit](git@github.com:pme123/orchescala/commit/aa95a2f50d8a85ca4b2aae2141b5db5b613df5e2)
- Added IdentityCorrelation signing. - see [Commit](git@github.com:pme123/orchescala/commit/0ff561089e59c642c8fa62445042a6130236f937)
- Added IdentityCorrelation to UserTask Complete. - see [Commit](git@github.com:pme123/orchescala/commit/c89654cb0ab1616805a240de09a109032b4a36df)
- Made it compatible with old solution. - see [Commit](git@github.com:pme123/orchescala/commit/401ed0e2155cf6d56afc3c3a05358b282a148394)
- Added IdentityCorrelation to the Gateway start process. - see [Commit](git@github.com:pme123/orchescala/commit/1486b9a6bdfc207ec88d06d87319a42d6ee79e4f)
- Added traits for OAuth2 flows for testability. - see [Commit](git@github.com:pme123/orchescala/commit/047954750df5803be8afbeae451ba351ba07176e)
- Refactored OAuth2Flow - tested with project. - see [Commit](git@github.com:pme123/orchescala/commit/e4cf0deaffef932d1c29ffc7f6a8c3bc5546f526)
- Adjusted GatewayServer with default run method. - see [Commit](git@github.com:pme123/orchescala/commit/67fe96932632bbc29805c2e206de7e8939a5fbaa)

## 0.2.29 - 2025-11-26
### Changed 
- Added catchall to handle unexpected errors in BaseWorker. - see [Commit](git@github.com:pme123/orchescala/commit/7b976b4a2f724a3a7022167993ec93596aaeaf49)
- Added ZIO versions to get tokens. - see [Commit](git@github.com:pme123/orchescala/commit/17b969f2338a35a62de2bd60a6b6a9baf9a1df4a)
- Removed second fork in BaseWorker. - see [Commit](git@github.com:pme123/orchescala/commit/4855e48e48606614601b456e3a022c9ee3ff8bb7)
- Added more logging for worker registry. - see [Commit](git@github.com:pme123/orchescala/commit/2138435deb6b17142d63d595548cf76d62551adf)
- Added timeout for running the worker. - see [Commit](git@github.com:pme123/orchescala/commit/2dc7a73ea352a4ac59386da5d44c153dd914d6ec)
- Made regex to match version easier in PublishHelper. - see [Commit](git@github.com:pme123/orchescala/commit/309fdf6814b8a60c62adab4a381b3a82691813d6)

## 0.2.28 - 2025-11-20
### Changed 
- Fixed classcastexception in GatewayRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/0c6f62b81d92db9662c0b9ea3da81ba956694ceb)

## 0.2.27 - 2025-11-19
### Changed 
- Adjusted UserTask complete endpoint for Api Documentation - removed process. - see [Commit](git@github.com:pme123/orchescala/commit/3ad6cb56072a75333b96ec476b48de1bfc106752)
- Added process getVariable endpoint for Api Documentation / cleanup paths. - see [Commit](git@github.com:pme123/orchescala/commit/def151ea44ae4e5ea92423fccfbcca9f7288a41a)
- Fixed Api Documentation. - see [Commit](git@github.com:pme123/orchescala/commit/d3d50b93142d2a9727dec327de2323773b24db34)

## 0.2.26 - 2025-11-19
### Changed 
- Fixed bad error messages in WorkerExecutor.validate. - see [Commit](git@github.com:pme123/orchescala/commit/1d4086a24dc86c3a0a496ee021434c86771e4498)
- Adjusted redoc url as the old link was broken. - see [Commit](git@github.com:pme123/orchescala/commit/5a820b46e432f4e03ccfa5032ec4fbc674ef0763)

## 0.2.25 - 2025-11-17
### Changed 
- Fixed bad grant_type_impersonate. - see [Commit](git@github.com:pme123/orchescala/commit/06b5302f06cfbf4b4efe1ce07ba325e1487e493f)

## 0.2.24 - 2025-11-06
### Changed 
- Switched  in getVariables to HistoricVariableService in GatewayRoutes. - see [Commit](git@github.com:pme123/orchescala/commit/243aaee618a2212c533f848fa978b022cdf64478)
- Added variableFilter in HistoricVariableService.getVariables. - see [Commit](git@github.com:pme123/orchescala/commit/518a1b8134cc6a4b67cb0cb2883a8fcf2527f00d)
- Adjusted the process endpoints descriptions. - see [Commit](git@github.com:pme123/orchescala/commit/26312462f21270cd979fc822f43f48aacb9fac39)
- Added get variables endpoint in ProcessInstanceEndpoints. - see [Commit](git@github.com:pme123/orchescala/commit/deb6c92edd2d301adec1c87333d7790cb67f7720)
- Added Postman Instructions in ApiCreator. Deprecated PostmanApiCreator. - see [Commit](git@github.com:pme123/orchescala/commit/771eec9b8be07d1d6d1ab20ec54c225d97c54f8e)
- Fixed all query parameters. - see [Commit](git@github.com:pme123/orchescala/commit/e9a1883e3f1b4094ee281eb3db58de0acbd4f0b1)
- Added query parameters incl. descr. in TapirApiCreator. - see [Commit](git@github.com:pme123/orchescala/commit/53e57c271798a15a8c97267c17d11d7b8712e16c)
- Added default values for path variables in TapirApiCreator. - see [Commit](git@github.com:pme123/orchescala/commit/b20a5105b65d9b847f4a702c7a11b3a0a8c67990)
- Fixed mixup with In/Out in UserTasks in TapirApiCreator. - see [Commit](git@github.com:pme123/orchescala/commit/f7f2a2cd65c4ae2e200a6e582d57f9a28e0f6fbb)
- Clean up new api generation. - see [Commit](git@github.com:pme123/orchescala/commit/6be7cb71d1acfa9ba3e122d3f28155cd9702fd7c)
- Fixed bad tests. - see [Commit](git@github.com:pme123/orchescala/commit/caf2eee6216f037a9a940d7b2cdb349f797fd404)
- Fixed bad UserTask endpoint generation. - see [Commit](git@github.com:pme123/orchescala/commit/4ed5feaa2abab67d3ec830c13ee97723c5743bba)
- Adjustments for description of elements and tag adjustments. - see [Commit](git@github.com:pme123/orchescala/commit/99fb4c775595cbe328af0ed75bc5fef967ef74e5)
- Removed run: sbt "compile; project engineGateway; generateOpenApi" in github pipelines. - see [Commit](git@github.com:pme123/orchescala/commit/900fce10f7681b1448d4cf91d79821e5a38f8e9c)
- Adjusted paths for gateway. - see [Commit](git@github.com:pme123/orchescala/commit/aa1b5ccade00caa5b5737b574a74a6df89493680)
- Update for dockerGateway in local docker-compose. - see [Commit](git@github.com:pme123/orchescala/commit/114d06388a7b2f7a2c942906b2ca6a82f79135f5)
- Working version with gateway project. - see [Commit](git@github.com:pme123/orchescala/commit/c5600918ce36048e65743ff2c114f22fd970b79c)
- Working version with gateway project. - see [Commit](git@github.com:pme123/orchescala/commit/87d49fadf3d50308ae668bf8c25110ebf99a7472)
- Added Worker Endpoint to run Worker in a generic Way without starting a Process. - see [Commit](git@github.com:pme123/orchescala/commit/87b06c594eff63a945f99dbff1ed27e805b68716)
- Using EngineError in Gateway. - see [Commit](git@github.com:pme123/orchescala/commit/4c1719c1358f2221627326af01c71761d4a64ef5)
- Reusing error examples. - see [Commit](git@github.com:pme123/orchescala/commit/fbeb926790a5c753c46a865f16b8bbf2a11f4c5a)
- Adjusted GatewayServer, to work also for C8. - see [Commit](git@github.com:pme123/orchescala/commit/5dfaa8decb88b42eb5e9723d1fba01008a98a667)
- Cleanup ExampleGatewayServer. - see [Commit](git@github.com:pme123/orchescala/commit/8fef1c9ee2082758637c0f38e843fe288046cb59)
- Added sendMessage. - see [Commit](git@github.com:pme123/orchescala/commit/0529d5f55978945509d5eeb571b8d7bfbdbf201a)
- Refactoring splitted endpoints. - see [Commit](git@github.com:pme123/orchescala/commit/2ec774a68b4a0a2a74a1679fb53b2735cff41e8d)
- Added tenantId if needed. - see [Commit](git@github.com:pme123/orchescala/commit/13d93bb240adb20c676c3b291b55ea9d49d7a531)
- Added sendSignal. - see [Commit](git@github.com:pme123/orchescala/commit/c628c218fc24d6872adabb0eee118cb9ab7966fb)
- Added completeUserTask. - see [Commit](git@github.com:pme123/orchescala/commit/b9a6acd7a2babced02686b4da014fc1bf1e4f7e3)
- Fixes and cleanup in GatewayEndpoints. - see [Commit](git@github.com:pme123/orchescala/commit/b48097ed6e4f31879febb90752d6b4c5887583b7)
- Added example ExampleGatewayServer. - see [Commit](git@github.com:pme123/orchescala/commit/aad795be71a23ccbbe22ba94e8801a316bd24c55)
- Added getUserTaskVariable of current Process Instance. - see [Commit](git@github.com:pme123/orchescala/commit/6b70beee921745b13ac505bc14e693033cda664d)
- Working Gateway Version with C7 without authentication. - see [Commit](git@github.com:pme123/orchescala/commit/3a1c4e12397af9cf3260829632ec4e6902d28332)
- Working documentation is shown on Gateway Server. - see [Commit](git@github.com:pme123/orchescala/commit/7cec12826d78b9b64c5f336e399e4ab3f30409a6)
- Added automatic generation of OpenApi specification in github actions. - see [Commit](git@github.com:pme123/orchescala/commit/69018580162975ee5d4bafc4954d975ea795a033)
- Added OpenApi documentation for the server. - see [Commit](git@github.com:pme123/orchescala/commit/a763ae6d0decc58267cc8671d8007f4d8a7b47e9)
- First version of a gateway http server. - see [Commit](git@github.com:pme123/orchescala/commit/2ac75cc52096ba305e6f02335531ddb485808e78)
- Added Alias for InitProcess Return Type. - see [Commit](git@github.com:pme123/orchescala/commit/17f4ab3e134c77363bd20a7007ed7e53b8df5f9a)
- Fix in ServiceClassesCreator / added debug info to TimerRunner. - see [Commit](git@github.com:pme123/orchescala/commit/a96c4727b5197e939f5dcd05c6a6cb6bd05fde3a)

## 0.2.23 - 2025-10-03
### Changed 
- Fixed Links in References - added company. - see [Commit](git@github.com:pme123/orchescala/commit/9202c9b73326788f59adf2bcf8600616ebbf8236)
- Added C8 support for Simulation in simulation.md - see [Commit](git@github.com:pme123/orchescala/commit/e78b04bc2402832609468d90f571243743d87fa2)
- Adjustments in c8_createFormFromUserTaskDsl. - see [Commit](git@github.com:pme123/orchescala/commit/a094cb8965e9bd6c0c971fe989dc2faccdcf7555)
- Added prompt c8_createFormFromUserTaskDsl. - see [Commit](git@github.com:pme123/orchescala/commit/5fb9810782c1c61883a74c960c25b92ca8c4b07c)
- Added exception for end event. - see [Commit](git@github.com:pme123/orchescala/commit/faee28ed4559d601a76611cee68bd372cb3450b5)
- Adjusted branches. - see [Commit](git@github.com:pme123/orchescala/commit/223397229b22c8157ca1971cdf8fa45f1ca9540b)
- Removed docs as it is now done by github action. - see [Commit](git@github.com:pme123/orchescala/commit/f6ef0543f85399855dad51d580891b18152ab044)
- Adjusted path to 00-docs/ in deploydocu. - see [Commit](git@github.com:pme123/orchescala/commit/7a2995c92f003e55f78cb1f1cf69b540a57f1a9e)
- Added setup and upload artifacts. - see [Commit](git@github.com:pme123/orchescala/commit/fe216bbef95f83b72e2d6dcf40cea9145099fc7e)
- Added rights for pages deploy. - see [Commit](git@github.com:pme123/orchescala/commit/df488c69004ba58c15523a30c4ca73a949924e12)
- Added sbt install. - see [Commit](git@github.com:pme123/orchescala/commit/6ceabab63631c1f5a57de9d036898b86b053aa3d)
- Try to run documentation without local files. - see [Commit](git@github.com:pme123/orchescala/commit/1725f5f7f7a214f19d9e11dfd1c2878d4fc6f6ae)
- Added migrationC7toC8.html. - see [Commit](git@github.com:pme123/orchescala/commit/d1e875f557f5dbcda233201df19801d759dd0606)


## 0.2.22 - 2025-09-26
### Changed 
- Create static.yml - see [Commit](git@github.com:pme123/orchescala/commit/5b3983cd916e398f78a3b622699771943c384798)
- Added documentation creation to ci. - see [Commit](git@github.com:pme123/orchescala/commit/fe5a05da8fe9a0c5965658bd43a538eaa5894aba)
- Added documentation creation to ci. - see [Commit](git@github.com:pme123/orchescala/commit/7123d4b350b4ffcb58eefb542a0015d169d448d6)
- Added documentation for C7 - C8 migration. - see [Commit](git@github.com:pme123/orchescala/commit/03d8028d6d6d3a2967c6ead5ebe20db76f09041a)
- Fixed DevStatisticsCreator filter only company code. - see [Commit](git@github.com:pme123/orchescala/commit/7e533c3556a532dfe586bf19e227fded2851deb4)
- Fix Signal and Message Services. - see [Commit](git@github.com:pme123/orchescala/commit/e44b0c2fcee6a29dd1a90ab7b27913780fc67941)
- Added correct cockpit url - diverse fixes in simulation/engine. - see [Commit](git@github.com:pme123/orchescala/commit/56b76922ab87b35f34720179956cd59d1fea2e24)
- Added sorted running of services - using cache to match processInstances. - see [Commit](git@github.com:pme123/orchescala/commit/8c90c822df95a965bca24338ab5af7302c65ddaf)
- Added first version of gateway services for the engine. - see [Commit](git@github.com:pme123/orchescala/commit/c0df2a88c671e68b78f7b3c856905e7fb7cd4ff2)
- Cleanup Services. - see [Commit](git@github.com:pme123/orchescala/commit/afe4d70a4125885d4f74e656cc2960acdbe07318)

## 0.2.21 - 2025-09-24
### Changed 
- Added Timer-, Message- and SignalEvent support to the simulations. - see [Commit](git@github.com:pme123/orchescala/commit/4bf79cdbbaa9c66a305ed7171f465db20960f150)
- Fixed links in Catalogs. - see [Commit](git@github.com:pme123/orchescala/commit/738a74b1c5aae86eec7a0d58713e00ea2e379ce0)
- Fixed bad links in catalog. - see [Commit](git@github.com:pme123/orchescala/commit/dc2d04ec35e879eb8c20b6e6149e3392acd4f6e2)
- Updated to new Links supporting multiple companies in the company documentation. - see [Commit](git@github.com:pme123/orchescala/commit/27b52f246a92e1b37ab8816143ea273a739f785c)
- Improved naming in simulations. - see [Commit](git@github.com:pme123/orchescala/commit/65c1bb8b25ed0de3f209159afa70875e085c4e15)

## 0.2.20 - 2025-09-17
### Changed 
- Updated versions. - see [Commit](git@github.com:pme123/orchescala/commit/d2ed13629bccb25c3bf5e47a8f8b0ef394670015)
- Fixed incident handling for error messages in root cause. - see [Commit](git@github.com:pme123/orchescala/commit/36089bae718e0caadd6c8fb9d999be438a6c3adb)
- Merge pull request #2 from pme123/feature/AdjustDomainClassGeneration - see [Commit](git@github.com:pme123/orchescala/commit/0829d57c85462a57ab84051c07ab8585e292d7a7)
- Some adjustments for OpenAPI generation. - see [Commit](git@github.com:pme123/orchescala/commit/4be950236d2db96dc40ce0a2d82ced03d41eee49)
- Merge branch 'develop' into feature/AdjustDomainClassGeneration - see [Commit](git@github.com:pme123/orchescala/commit/29093fb290de809bb868ac16dd94e067931bca62)

## 0.2.15 - 2025-09-11
### Changed 
- Support handledErrors in causeError in BaseWorker. - see [Commit](git@github.com:pme123/orchescala/commit/3f0403ac24ea4157acdbd0b8adf36c06c230f636)
- Added configurable doRetryList to EngineContext. - see [Commit](git@github.com:pme123/orchescala/commit/0cfd1ee2760d9daa10fb06357d7ace6d811cb680)
- Fix in checking if element is in array. - see [Commit](git@github.com:pme123/orchescala/commit/c57fe9aacc3c659b4edb98fbfe11ca0d3e15c140)
- Adjusted redoDefaultValuesToExamples.txt - see [Commit](git@github.com:pme123/orchescala/commit/ffaf2cdb6f31485205ac6f55818aefabe5140d87)
- Working at multiple documentations for different companies. - see [Commit](git@github.com:pme123/orchescala/commit/15db8f8a126cb09c607b88df3e45195146bbf4b5)
- Added 'Connection could not be established with message' to retry errors in C7Worker. - see [Commit](git@github.com:pme123/orchescala/commit/6b43ac20402377e0e5a6e2f9df158669dc5575ec)
- Added examples for NoInput / NoOutput - see [Commit](git@github.com:pme123/orchescala/commit/7f2d2c6c72baae79589068f6b837f2b522a222aa)
- Renamed to SInOutServiceStep (bad name before) - see [Commit](git@github.com:pme123/orchescala/commit/ebc694a428596700623d1183f59901fe025c9bed)

## 0.2.14 - 2025-08-21
### Changed 
- MAP-10799: Fixed missed retry because error message was in the cause. - see [Commit](git@github.com:pme123/orchescala/commit/caff99152fe889b2c3db6ae1ebe603ff68290263)
- Changed Simulation to SharedClientManager. - see [Commit](git@github.com:pme123/orchescala/commit/e068b14dc6309cf55bb0a9da9d36c173b7fdc6d9)
- SharedC7ClientManager provided as Environment. - see [Commit](git@github.com:pme123/orchescala/commit/42cb29ba51e122055a2fda0de36f1ff2174c0f95)
- SharedC8ClientManager provided as Environment. - see [Commit](git@github.com:pme123/orchescala/commit/05fe2d33f9897ecdd9ebf872fb25b3d3a4c09dc8)
- Removed unsafe from semaphore in SharedC8ClientManager. - see [Commit](git@github.com:pme123/orchescala/commit/c47e4efbd7aff2613e86f577aaca3401c14b6c7a)
- Removed unsafe from clientRef in SharedC8ClientManager. - see [Commit](git@github.com:pme123/orchescala/commit/22c77900675fd639ac145f6bca79a5e22043f509)
- Fixed double execution in simulations. - see [Commit](git@github.com:pme123/orchescala/commit/88093837cebad5eac2d79b4f47a2afc88bfc2e54)
- Adding more AI prompts. - see [Commit](git@github.com:pme123/orchescala/commit/6b03fcd80016e56883f917d1a5b44fad9355ce83)
- Fixed SharedC7ClientManager - see [Commit](git@github.com:pme123/orchescala/commit/d6795693c982889aa9903a10fb43a880e15c86ac)
- Added SharedClientManagers - see [Commit](git@github.com:pme123/orchescala/commit/84a35cea844b601c06ade12bcce71d9e6a6262eb)
- Added userTaskId to getUserTask in engine. - see [Commit](git@github.com:pme123/orchescala/commit/c8ad0d8fd62603f9aaacf57ba10e3cbde1b75c0c)
- Added new directory for AI prompts - see [Commit](git@github.com:pme123/orchescala/commit/f1d7e7b3a533ca18555a8830c3a0f71b69e86dbd)
- Added Test for method in WorkerGenerator for ServiceWorker. - see [Commit](git@github.com:pme123/orchescala/commit/59f1aebf50652544dbed890fac528ea5884d152b)
- Fixed bad Path in ModelerTemplUpdater. - see [Commit](git@github.com:pme123/orchescala/commit/694282feee033690875613de5726f2c9f73ac593)
- Added UserTask for c8 Simulation. - see [Commit](git@github.com:pme123/orchescala/commit/a460e41fce7c849a4a6814df594b28e81971dd3d)
- First working Template generation for C8. - see [Commit](git@github.com:pme123/orchescala/commit/b046bdc1785b55f7d1062e57145acc888e79dc89)
- First version for C8 TemplateGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/02f3157b8c351498af3ac485bd75a4fc8be6acb0)
- Adjusted Generators for new example Pattern. - see [Commit](git@github.com:pme123/orchescala/commit/b933016a843b45de00546678a9c9f9ec2655a4d2)
- Adjusted bpmnDsl.md documentation. - see [Commit](git@github.com:pme123/orchescala/commit/ec86c7f57a4679f58c664be18fc71b9f27de80a9)
- Added mocking flag, if mocked and no mocked error handled. - see [Commit](git@github.com:pme123/orchescala/commit/7882e594c725e0e8f744245645b5ff355ef38015)
- Working C8 empty process incl. variable handling. - see [Commit](git@github.com:pme123/orchescala/commit/7375865905f8aa3a9cd3b50770227da56c0eff1e)
- Working C8 empty simulation. - see [Commit](git@github.com:pme123/orchescala/commit/bed330e7b8ca5d9aca37d167cdc9bc3a74c781a1)
- Removed old simulation. - see [Commit](git@github.com:pme123/orchescala/commit/d0e281ef51ee1da9e772651442532b863018dcb3)
- Adding C8Client to engine / added first services for C8 engine. - see [Commit](git@github.com:pme123/orchescala/commit/402baa503e3d0efb7fbd879eb67dc99be36560c0)
- Working version for C8 Worker with mocking. - see [Commit](git@github.com:pme123/orchescala/commit/4ffb4d37895ebc17b46e873fa0db1f53929d8447)
- Working version for C8 Worker and C7 Worker next to each other. - see [Commit](git@github.com:pme123/orchescala/commit/52e3e89f128e8794169c40bf10e1767d12d483a7)
- Working version for C8 Worker implementation. - see [Commit](git@github.com:pme123/orchescala/commit/a798ac9868bb396f00aa5101f203e5ffe183ee24)
- First stubs for C8 Engine implementation. - see [Commit](git@github.com:pme123/orchescala/commit/c7e7e46c1e6f4dd8468edc400dbfceafe0f42264)
- Adjustments in Open API / Code generation. - see [Commit](git@github.com:pme123/orchescala/commit/76d14500050f4e5862e1dad492a6d7e19742a909)
- Adjustments in Open API / Code generation. - see [Commit](git@github.com:pme123/orchescala/commit/616c34213cefdcdefbe19276befbe5a02f960467)

## 0.2.13 - 2025-07-21
### Changed 
- Adjustments in Open API generation. - see [Commit](git@github.com:pme123/orchescala/commit/6da6c3d8c2242d11b2abc9c6d80cad0ab4579f13)
- Added type RunWorkZIOOutput in worker. - see [Commit](git@github.com:pme123/orchescala/commit/731e258441117c8088cdc33b30234d75188696c5)
- Added also only workerDependencies to generate ProjectDef file. - see [Commit](git@github.com:pme123/orchescala/commit/446e9a8fce461208019f0d9403838f32cb9ec6f5)

## 0.2.12 - 2025-07-17
### Changed 
- Fixed not handled nullpointer exception in RestApiClient. - see [Commit](git@github.com:pme123/orchescala/commit/0e394d206be74d52c271bbc4a4833f9fe99cfc9f)

## 0.2.11 - 2025-07-16
### Changed 
- State of work OpenAPI Code generation with new example pattern. - see [Commit](git@github.com:pme123/orchescala/commit/817056589bf4ad6d44adb9695445ae9f9b3d77f2)
- Adjustments in PostmanApiCreator to support more companies. - see [Commit](git@github.com:pme123/orchescala/commit/5d8daae931be4fbe81039982a4310e67e56b7485)

## 0.2.10 - 2025-07-14
### Changed 
- Changed ApiConfig.init to run in parallel with ZIO. - see [Commit](git@github.com:pme123/orchescala/commit/ce53dfcc7950fb37be63c39485c872e47546efb8)
- Fixes for Company ApiCreator and References of used by. - see [Commit](git@github.com:pme123/orchescala/commit/1b1bbdd7bab271caad9a322b71805b4343e935a4)

## 0.2.9 - 2025-07-11
### Changed 
- Fixes for ApiCreator for other project / dependencies - new workerDependencies. - see [Commit](git@github.com:pme123/orchescala/commit/8f925cfd47c327109872e5cd2bbcb79cafdc195b)
- Fixes for release other project. - see [Commit](git@github.com:pme123/orchescala/commit/5c16e053b510acff17e1a8b772861041f2724140)
- Adjusted companyHelper init code generation. - see [Commit](git@github.com:pme123/orchescala/commit/e5bc057674198aec9a8357e57873bdcc41fe0b6d)
- Added 'Unexpected error while sending request' to retry list / added cause to error message. - see [Commit](git@github.com:pme123/orchescala/commit/c11f77ea84029e4b41856721c17d179ba4eb0348)
- Fixed hidden errors ZIO.fromEither in ServiceHandler. - see [Commit](git@github.com:pme123/orchescala/commit/931918aea35acdc9903cdffbda059abb8a1df5c4)

## 0.2.8 - 2025-07-07
### Changed 
- Adjusted SSO_BASE_URL - as the path may be different on local and remote environments. - see [Commit](git@github.com:pme123/orchescala/commit/066f211af177d4a4bf37c7158aef3c13619780b5)
- Fixed workerModule.srcPath in CompanyWrapperGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/544e744529fe542a509cdb06ab7ae9f978b8d143)

## 0.2.7 - 2025-07-04
### Changed 
- Added /auth to default SSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/b7e9e3f274c5a0d399f8021db7591cb1ec4e7610)
- Adjusted Generators, to generate in-out Examples. - see [Commit](git@github.com:pme123/orchescala/commit/db947c58b8727127f0be41194a927dc890377265)

## 0.2.6 - 2025-07-03
### Changed 
- Removed generation of Intellij/VSCode run configuration. - see [Commit](git@github.com:pme123/orchescala/commit/05a856e018b2254e490f3c9810f936c989f571c0)

## 0.2.5 - 2025-07-03
### Changed 
- Adjusted Generation files for SSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/f1ed0c1558b7fd55e0e30fd44dc1e95dcc03a995)
- Changed DOCKER_INTERNAL_HOST to SSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/11aa3413acd4a0f364a2becec1046dac207da3bf)

## 0.2.4 - 2025-07-02
### Changed 
- Fixed Logging Configuration for simulaitons / shared logging. - see [Commit](git@github.com:pme123/orchescala/commit/86e6c05a35f873f3302abf360b491381cdb83956)
- Fixed Logging Configuration for workers. - see [Commit](git@github.com:pme123/orchescala/commit/821d9150700c3744ae6ea2c99731939059ea3cd7)

## 0.2.3 - 2025-07-02
### Changed 
- Merge pull request #1 from pme123/feature/adapt-newman-cmd - see [Commit](git@github.com:pme123/orchescala/commit/db4efa93ef470d054a2a3dbf3ea7077bbd210e23)
- debug message added - see [Commit](git@github.com:pme123/orchescala/commit/84129ff5b57d742449fd283d980501c3e69e8b7d)
- check if DOCKER_INTERNAL_HOST is present and overwrite env var'st - see [Commit](git@github.com:pme123/orchescala/commit/6aef25f6135fb98f8f6a02bcc2f8b65ea3ac5c20)
- Added more debug information to the Regex Error matching. - see [Commit](git@github.com:pme123/orchescala/commit/0e8967fe9904d36c6d21470bd3a5b4f63cddc9ec)
- Cosmetics in Simulations. - see [Commit](git@github.com:pme123/orchescala/commit/59558a5f7606090dae0d5f18bdb2f198c6b37b64)

## 0.2.2 - 2025-06-24
### Changed 
- Fixed impersonateUserId as In parameter for simulation. - see [Commit](git@github.com:pme123/orchescala/commit/cf29daa04e8f906c02461cafc4d45a98c6326750)

## 0.2.1 - 2025-06-24
### Changed 
- Fixed null values in jsons in ResultChecker. - see [Commit](git@github.com:pme123/orchescala/commit/25578d64b832405acd7e405935588882a898eda3)
- Merge branch 'simulation2' into develop - see [Commit](git@github.com:pme123/orchescala/commit/3891156d9a3b2d6d31fef502ab28c6ab063f7ae5)

## 0.2.0 - 2025-06-23
### Changed 
- Added sendMessage to start process in Simulation. - see [Commit](git@github.com:pme123/orchescala/commit/de234a8eafc70b6c8c10676cede587168291ebb0)
- Adjusted simulation documentation. - see [Commit](git@github.com:pme123/orchescala/commit/4d5e8ccdcf98e26db206b39fa9bb8a6793f6ac03)
- Fixes in new Simulation / adjusted Generation. - see [Commit](git@github.com:pme123/orchescala/commit/a15122da66420b138dc4ae1676950694efd92747)
- Replaced Simulation with Simulation2. - see [Commit](git@github.com:pme123/orchescala/commit/00f4674bd1ef4f2b115f3d896f6aa356acd28e9a)
- Added BadScenario in Simulation2. - see [Commit](git@github.com:pme123/orchescala/commit/a3ee71d3c2284bcfbd412e0db0527bdf3090f5f8)
- Added IncidentScenario in C7JobService. - see [Commit](git@github.com:pme123/orchescala/commit/2d1c2720485a57fb25c6278ea2efbf37b0433d99)
- Fixes in C7JobService. - see [Commit](git@github.com:pme123/orchescala/commit/b25a102cdfa46f5c0392fa7bb9062dad5901a3c4)
- Added TimerRunner to Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/96c1339ca91b72f3b406af4fef7ac7815b322797)
- Added MessageRunner to Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/e42f229bda9222f8c5ee14d5ade1d5768e90e3b3)
- Added Signals to Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/40f15de32ac4a6a4b539f4948b8363af7b7c85f2)
- Added JobService in Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/9cf2d57514d433f6c579d059c29b7c1601768819)
- Testing differences in Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/bbe196838ac347b66a3f9fea0aeef8b4b3e38a71)
- Working UserTaskScenarios in Simulations2. - see [Commit](git@github.com:pme123/orchescala/commit/6fd25c9cc78523e7bb098837f504faa106a3b7fb)
- Working ProcessSimulation with only services. - see [Commit](git@github.com:pme123/orchescala/commit/9b7026dd0ec801e48ec93b6a05d99387ae541342)
- Working ProcessScenarioRunner. - see [Commit](git@github.com:pme123/orchescala/commit/020fdf64857e33418617cb48c52ef0ec02c1b252)
- Simulation2 state of work - see [Commit](git@github.com:pme123/orchescala/commit/a36464faf26fe7622ac0478226ce95c1b510772a)
- Json version - compiling. - see [Commit](git@github.com:pme123/orchescala/commit/2bb2ad35f14937383646f5c3ed24a79545724265)
- Typed version - not working. - see [Commit](git@github.com:pme123/orchescala/commit/01fa9d5e818901a8d6128dbcb85a555b01364951)
- Added engine and engineC7 modules starting with the engineGateway. - see [Commit](git@github.com:pme123/orchescala/commit/ab7a0620fe8b2dab5196849051c98a2d01e207c0)
- Removed duplicate error logging. - see [Commit](git@github.com:pme123/orchescala/commit/574ac514a70a834452096636af598c160f24fa4b)

## 0.1.8 - 2025-06-04
### Changed 
- Small adjustments in SharedHttpClientManager. - see [Commit](git@github.com:pme123/orchescala/commit/5f683a172f2687bcd90c9453c744d50a629d8b5f)
- Added SharedHttpClientManager / HttpClientProvider.sharedHttpClient. - see [Commit](git@github.com:pme123/orchescala/commit/c6a025da52b818e617c235c6a09b2237ecfa6888)
- Removed logTech from WorkerApp. - see [Commit](git@github.com:pme123/orchescala/commit/1daa77060315df6fca83d4d39d6ca2c1853294b2)
- Only create one async HTTP client and close it at the end. - see [Commit](git@github.com:pme123/orchescala/commit/c723984232d8a51f3eb3e753be3ede808e10c023)
- Improved Thread debugging. - see [Commit](git@github.com:pme123/orchescala/commit/0b1f218f426b3723771b574fb0ae2f7a8ef58143)
- Adding HttpClientProvider. - see [Commit](git@github.com:pme123/orchescala/commit/cfd6172045cd67e179230b4e5fc1dce455316331)
- Added MemoryMonitor / fixed memory leak with runToFuture (using fork) in C7Worker / C8Worker. - see [Commit](git@github.com:pme123/orchescala/commit/f69185f43251995f67775b1f4b92526c8518a16d)

## 0.1.7 - 2025-05-21
### Changed 
- Added finalizer for thread pool/ only create thread pool once. - see [Commit](git@github.com:pme123/orchescala/commit/6bc0922274bcd601dd3ea7ec448ef776a3f10022)
- Adjusted that only one thread pool is created. - see [Commit](git@github.com:pme123/orchescala/commit/bb48ab931fde664a2e6b4e941f39a612ad8afe56)
- Changed logging Worker execution to processInstanceId. - see [Commit](git@github.com:pme123/orchescala/commit/a8c00908823e06c929c5359f63c440fd1285f68f)
- Removed logInfos for validation in WorkerExecutor. - see [Commit](git@github.com:pme123/orchescala/commit/24b006095a2a253deab0654f738a8efaeb73eb13)

## 0.1.6 - 2025-05-21
### Changed 
- Changed to managed thread pool / update to scala 3.7.0. - see [Commit](git@github.com:pme123/orchescala/commit/0094d5241ab8d04a226ecd4d9075275925d77875)
- Updated Scala Version. - see [Commit](git@github.com:pme123/orchescala/commit/41bdc4e406fdb52c8c529f63b5a006989b643707)

## 0.1.5 - 2025-05-20
### Changed 
- Adjustments in company project and worker documentation / generation. - see [Commit](git@github.com:pme123/orchescala/commit/a742498b19daf3b99c1c6afd0ac80fe27b92f774)
- Fixed decoding function for LocalDate. - see [Commit](git@github.com:pme123/orchescala/commit/9c57e5d940d518cf901ad4a76dfef83ace2d770d)
- Changes in company generator. - see [Commit](git@github.com:pme123/orchescala/commit/0d6b6a6e97b1317d1bd088b00dcf7ee95f1190db)
- Added check for correct version in helper.scala - see [Commit](git@github.com:pme123/orchescala/commit/a4ed4025322762741a5b9be0cbacf7511bbd2ad3)

## 0.1.4 - 2025-05-11
### Changed 
- Cleanup Registries. - see [Commit](git@github.com:pme123/orchescala/commit/aa30ec1bac0fab77b534fe887cd888108f6271bc)
- Renamed OrchescalaWorkerError to WorkerError. - see [Commit](git@github.com:pme123/orchescala/commit/a291bd23ce1c73276229848edf495f20913406ae)
- Adjusted README. - see [Commit](git@github.com:pme123/orchescala/commit/8ed5b40eb1322b88d184899a35e0378ba4b3037f)

## 0.1.3 - 2025-05-09
### Changed 
- Fixed bad package- and DevCompanyOrchescalaHelper name. - see [Commit](git@github.com:pme123/orchescala/commit/2ed750ebdc21425961095567a99fbc7ebf277eca)

## 0.1.2 - 2025-05-09
### Changed 
- Adjustments for new Sonatype portal. - see [Commit](git@github.com:pme123/orchescala/commit/51a212d3e9310e5b738f6077f9fd3a1471fc8ce3)
- Added favicon.ico - see [Commit](git@github.com:pme123/orchescala/commit/e6cd8ce946627091b8e027a5df57d9985d958f1f)

## 0.1.1 - 2025-05-09
### Changed 
- Generate docs for release. - see [Commit](git@github.com:pme123/orchescala/commit/6b310bf3c10a1fa1c5f3148655ad7f598b6d8ad5)
- Testing generate docs. - see [Commit](git@github.com:pme123/orchescala/commit/c8b2fe5ad4d08c17a1c834171e71182c5781cddb)

## 0.1.0 - 2025-05-09
### Changed 
- Fixes for  04-worker-c7/8 - see [Commit](git@github.com:pme123/orchescala/commit/9f66a15950506531bc3c06ec94fbdad606d98db9)
- Added 04-worker-c8 - see [Commit](git@github.com:pme123/orchescala/commit/0296f1343d352fff50fbed4ba93cb18e8200724d)
- Added 04-worker-c7 - see [Commit](git@github.com:pme123/orchescala/commit/dcac7e3e68a0c5fb30af87690c6ddde196fe2c3a)
- Added 03-worker - see [Commit](git@github.com:pme123/orchescala/commit/cda7775dd00980831df4ac3bb713b22d3f60dbed)
- Fixed ide compile problems in 04-helper - see [Commit](git@github.com:pme123/orchescala/commit/a28105db678ee33e77f8d5fb68af00f84adfb51e)
- Added 04-helper - see [Commit](git@github.com:pme123/orchescala/commit/6c46f04b44f4d7ff63b77a9ffa7c28c73184da9f)
- Added 03-simulation - see [Commit](git@github.com:pme123/orchescala/commit/3908db9b734a783eadce0f276ab71c16de8d78c0)
- ignored ApiProjectConfigTest. - see [Commit](git@github.com:pme123/orchescala/commit/4271860b122bb36a382d0dbee587c61a6598fe79)
- Added 03-dmn - see [Commit](git@github.com:pme123/orchescala/commit/81aaabb2f66200f2d6ce6998feba36e691e9783e)
- Added 03-api - see [Commit](git@github.com:pme123/orchescala/commit/cac620c3309e8893afb8c51e64741f1bdf33a243)
- Added permissions to ci.yml. - see [Commit](git@github.com:pme123/orchescala/commit/82c5ff09728bc87dfc476be8206b434f522f8a49)
- Adjusted Test config in ci.yml. - see [Commit](git@github.com:pme123/orchescala/commit/4d9cbd9e366f2b570ef3007f7c2b81931f10d349)
- Moved 01-domain to orchescala. - see [Commit](git@github.com:pme123/orchescala/commit/df618be5f0f0fedc7c8ad5281e9b26f6a4f58067)
- Added 01-domain. - see [Commit](git@github.com:pme123/orchescala/commit/35bca3b27ee584c0c3d5d3f91d5ff742d0b28d5c)
- Added sbt project. - see [Commit](git@github.com:pme123/orchescala/commit/4e7093e61676b98a12def5eb08ba8bc3a8e6557f)
- Added git actions. - see [Commit](git@github.com:pme123/orchescala/commit/273336c7319b9f89d78b044f169d47ffa5e0af22)
- Added Logo to index.md - see [Commit](git@github.com:pme123/orchescala/commit/d5164e4527428867df0038e09091932d0d04479c)
- Added 00-docs. - see [Commit](git@github.com:pme123/orchescala/commit/9786d4d2c61eaf4fade21dcf3b4c5e90facd6115)
- Added README.md - see [Commit](git@github.com:pme123/orchescala/commit/8d20f2562716316765e089df40069c35781f0ad4)
- Initial commit - see [Commit](git@github.com:pme123/orchescala/commit/66fac8aa3d0f63bf6e05612160ac505883166f89)
