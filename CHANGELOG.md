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
