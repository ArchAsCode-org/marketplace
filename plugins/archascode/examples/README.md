# archascode spec examples

Six worked `architecture.yml` files, copied verbatim from the engine's
CI-verified test fixtures. Read them in order — each adds language.

| Example | Demonstrates |
|---|---|
| `01-minimal-crud` | Smallest complete spec |
| `02-rental-booking` | Realistic mid-size: relationships, invariants, VO, mutating use_case method |
| `03-value-objects-enums` | Simple/composite VOs, enums |
| `04-entity-methods` | Method shapes, use_case promotion |
| `05-invariants-derived` | Derived attributes, None propagation |
| `06-custom-use-cases` | Custom ports, UCs, memory.reads |

Each file is copied unmodified from `pypackages/engine/tests/fixtures/` in
this repo, where it is rendered and validated on every engine test run.
Every example is a valid input to `archascode validate`.
