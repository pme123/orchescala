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
- Adjusted FSSO_BASE_URL - as the path may be different on local and remote environments. - see [Commit](git@github.com:pme123/orchescala/commit/066f211af177d4a4bf37c7158aef3c13619780b5)
- Fixed workerModule.srcPath in CompanyWrapperGenerator. - see [Commit](git@github.com:pme123/orchescala/commit/544e744529fe542a509cdb06ab7ae9f978b8d143)

## 0.2.7 - 2025-07-04
### Changed 
- Added /auth to default FSSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/b7e9e3f274c5a0d399f8021db7591cb1ec4e7610)
- Adjusted Generators, to generate in-out Examples. - see [Commit](git@github.com:pme123/orchescala/commit/db947c58b8727127f0be41194a927dc890377265)

## 0.2.6 - 2025-07-03
### Changed 
- Removed generation of Intellij/VSCode run configuration. - see [Commit](git@github.com:pme123/orchescala/commit/05a856e018b2254e490f3c9810f936c989f571c0)

## 0.2.5 - 2025-07-03
### Changed 
- Adjusted Generation files for FSSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/f1ed0c1558b7fd55e0e30fd44dc1e95dcc03a995)
- Changed DOCKER_INTERNAL_HOST to FSSO_BASE_URL. - see [Commit](git@github.com:pme123/orchescala/commit/11aa3413acd4a0f364a2becec1046dac207da3bf)

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
