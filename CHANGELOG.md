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
