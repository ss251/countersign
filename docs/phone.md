# The phone runner

A phone can be a seller. `apps/phone` is a small web page that opens on a phone, dials out to the hub over the same runner WebSocket as `packages/runner`, proves a seller key it keeps on the device, and serves two skills that come from the phone itself: where it is, and a photo the person takes when asked.

Nothing is installed. No tunnel is opened, and the phone listens on no port, because the runner dials out.

```
buyer CLI ──HTTP 402 / x402──▶ hub ◀──runner WebSocket (dialled by the phone)── phone page
   │                            │                                                 │
   └─ countersigns, funds ──▶ escrow on Arc ◀── release(jobId, slipHash, sellerSig) ┘
```

## What happens

1. **A key made on the phone.** On first open the page makes a fresh key with viem and keeps it in IndexedDB, for that site, on that device. Only signatures leave the page. The key signs three things: the hub's sign-in nonce, the two offers, and each slip.
2. **The person turns a skill on.** Each skill has its own switch, in plain words. Turning location on asks the browser for permission and reads one position, to show the accuracy the phone gets. Turning photos on asks for nothing yet. Nothing is read or captured before that tap. Turning a skill on publishes its signed offer (`POST /offers`) and says hello to the hub again with the offers that are on.
3. **The hub dispatches a paid job.** Once the buyer's money is in escrow, the hub sends the job down the socket. Before the phone reads anything, it checks the job:
   - the input against the offer's schema;
   - the order's price, payee, rail and asset against the offer;
   - on the escrow rail, the job itself on Arc. The escrow must be one of the pinned CountersignedEscrow deployments (`KNOWN_ESCROWS` in `packages/verify`), and its `jobOf` must show the job funded, for this seller and this offer, at no less than the price, with the deadline ahead.

   The hub writes the order, so only the chain read stops a hub that funds one unit and claims the full price. A job that fails any check is refused, and nothing is read or captured for it. Then:
   - **location:** it reads one fresh fix, at high accuracy, never a cached one, and never watches the position between jobs;
   - **photo:** it shows the request, the buyer's prompt and how long the hub will wait. The person takes the picture or declines. The page shrinks the picture to at most 800 px, re-encodes it as JPEG, which drops the camera's EXIF metadata (any GPS position included), and hashes the bytes.
4. **The phone signs the slip.** It builds the slip body with `slipBodyFor` from `@countersign/core`, as `packages/runner` does, and signs the EIP-712 `Release` under the escrow's domain.
5. **The hub checks and releases.** The hub's delivery gate checks the output against the offer's schema and the slip against the seller's key, then releases the escrow with the seller's signature. The page reads `GET /jobs/<jobId>` and shows the release transaction.

The protocol is `packages/runner`'s, frame for frame: `challenge` → signed `hello` with the offer hashes → `ready`, then `job` → `result` or `fail`, and `ping` → `pong`. The hub needed no change.

## The two skills

| Skill | Price | Deadline | Input | Output |
|---|---|---|---|---|
| `phone-location` | 0.01 USDC | 120 s | `{reason?}`, at most 140 characters, shown to the owner | `{lat, lon, accuracyM, at}` |
| `phone-photo` | 0.05 USDC | 300 s | `{prompt?}`, at most 140 characters, shown to the owner | `{mime, width, height, bytes, sha256, data, at}` |

Both take the escrow rail on Arc testnet, with a declared bond of 0. The definitions are in `apps/phone/src/runner/skills.ts`.

Canonical JSON carries only safe integers as numbers, so a float cannot be hashed. Latitude and longitude therefore travel as decimal strings with six places (about 0.1 m), the accuracy as whole metres rounded up, and every time as unix seconds. The photo travels as base64 JPEG bytes beside their sha256 in hex, at most 400 kB of JPEG. A result frame stays under the 1 MB ceiling `packages/runner` puts on one output, and far under the 16 MB the hub's WebSocket accepts.

## What a slip proves

- **This key returned exactly this output for this job.** `slip.body.outputHash` is `keccak256` of the output's canonical JSON, and the seller signed the slip under the escrow's EIP-712 domain.
- **The picture the buyer received is the picture the phone sent.** `sha256(base64-decode(output.data))` equals `output.sha256`, and `outputHash` commits to both.
- **The escrow released against that slip.** The `Released` event on Arc carries the slip's hash.

## What it does not prove

- **Where the phone was.** The position is what the phone's browser reported. A desktop browser can report any position (its developer tools emulate one), and so can a phone running a location spoofer. The slip proves what the device said and when, not that it was there.
- **That the photo was taken just now, or by a camera.** The page asks for the camera with `capture="environment"`, but a browser that ignores the hint, and every desktop, offers a file picker instead. A buyer's prompt helps a buyer judge freshness. It is not a proof.
- **Who holds the phone.** The key belongs to whoever opened the page. It is not tied to a person or to a device identity.

## Limits

- **The page must stay open.** The phone serves only while the page is open and in the foreground. While a skill is on, the page holds a screen wake lock where the browser offers one. A phone that sleeps or switches apps drops the socket, the hub marks its offers offline, and a call to them answers `503 seller offline` with nothing charged.
- **A person has about two minutes.** The hub waits up to 120 s for a job (its default `jobTimeoutMs`), less when the offer's deadline is nearer. A photo not taken by then is refused, and the escrow refunds the buyer at the deadline.
- **A paused page loses its job.** If the browser pauses the page while the camera is open, and the hub hears no reply to its heartbeat for 45 s, the hub drops the connection, the job fails, and the buyer is refunded at the deadline.
- **The key is a browser key.** Anything running on this origin, and anyone holding the unlocked phone, can read it. It is for testnet only: never send it real money. Clearing the site's data loses the key, and its offers stay listed, offline, under the old seller.
- **The phone reads Arc through a public RPC.** If that RPC is down, a paid job is refused rather than served unchecked, and the escrow refunds the buyer at the deadline.
- **Every browser is a new seller.** Each browser that turns a skill on publishes two offers under its own key. They stay listed after the page closes, because the hub has no seller-side delisting yet.
- **The hub is fixed.** A link may name a hub with `?hub=`, but the page accepts only the hub it was built for, its own origin, or loopback for development. A hub decides which jobs reach the phone, so a stranger's hub could ask for its position with nobody paying.

## Proof

- **Browser acceptance, 06 Nov 18:58 IST.** The page ran in a browser with phone emulation against the production hub. Location was granted at an emulated position, 19.0760, 72.8777, within 20 m. The page made its own seller key in the browser and published both offers under that seller's address, `0xce1e838Cb01B908049C2Eb90b3Da4d71cC887915`, then served two buyer-CLI orders. It read each job as funded on Arc before doing any work.
  - **Location, 0.01 USDC.** The phone returned `{"lat":"19.076000","lon":"72.877700","accuracyM":20,"at":1793971712}`, and the slip [`0x4320274e…dcadf`](https://hub-production-e85e.up.railway.app/slips/0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf) commits exactly that output. Released in [`0xa3898552…ff73`](https://explorer.testnet.arc.io/tx/0xa3898552f658247fc3e4e259ec61e1e99259af762e68a5b885171e41ca98ff73).
  - **Photo, 0.05 USDC.** The picture was attached from a file, because an emulated browser has no camera. The page shrank it to an 800 × 450 JPEG with sha256 `647f84df1f50126721da4b0567926e8a9a9908463d932d523a6aa8db6a3eb8e7`, and the slip [`0x78dd5f5c…9324`](https://hub-production-e85e.up.railway.app/slips/0x78dd5f5c9651c31f132bd39ce3820d1150e6fd32dc9e46c59c1e47f2b9bb9324) commits the bytes and their hash. Released in [`0xd3fc7654…94a8`](https://explorer.testnet.arc.io/tx/0xd3fc76540f0d91767b56f1c0ebceef077eb0208a044614e207b6bb53bb0994a8).
  - Each `Released` event carries its slip's hash, and the phone's address received 0.0594 USDC in all. A real phone with a real camera has not been checked yet.
- **Bench run, 06 Nov.** The phone's own runner code (`RunnerLink`, the skills and the signer), run in a terminal with a stated position rather than a sensed one, served an order from the buyer CLI through a hub on the Arc escrow `0x19c27D770969291E6A0a305dc1Be1a845E7c1b76`. Slip `0xe43bc227a292a18c72d2ee010f7fca7d49b0872bf92e3df86d526632b49bee4c`, released in [`0x1c214d02…899b`](https://explorer.testnet.arc.io/tx/0x1c214d02fd17dd4deacf46160ad0458a559865d39bb1fc0dca827e8872b5899b). The `Released` event carries that slip hash; the seller received 0.0099 USDC and the toll 0.0001.
- **Bench run with the funding check, 06 Nov.** The same bench, now reading `jobOf` on Arc before serving, served a second buyer-CLI order: slip `0x9f5b5ca18c2903f26830fa9c75755eabda4e95874e18f76049bda3440aadae99`, released in [`0x252ec40a…1f51`](https://explorer.testnet.arc.io/tx/0x252ec40ae3b04b50e9d7697080c375f85dda1c22409ae22b69ef8bb399d81f51).

## Run it

- **The page:** `bun run --cwd apps/phone dev`, then open `http://127.0.0.1:5193/`. It talks to the production hub by default. `?hub=/hub` reaches a hub on `127.0.0.1:8787` through the dev server's proxy, WebSocket included. Location, the camera and WebCrypto need a secure context: https, or localhost.
- **Without a phone:** `apps/phone/test/bench.ts` serves the same runner code from a terminal, with a position you state. It is the project's own protocol check, not a phone, and not a way to sell.
- **Tests:** `bun test apps/phone`. They run the phone's runner code against the real hub in process: delivery and release, a declined photo, a person slower than the hub's wait, a hub that funds one unit but orders the full price, re-registration when a skill is turned off, an offer under another key, and a frame-by-frame check that the key never leaves the phone. `funding.test.ts` covers each refusal of the funding check.
