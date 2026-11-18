# Voice Playground provider APIs

Reviewed November 18, 2026. The review used official documentation found through Exa and source code inspected through CodeGraph.

## Verification status

| Area | Status |
| --- | --- |
| GenVoice | Studio supports voice generation, dubbing, Voice Changer, MiniMax cloning, and Scribe. Some job types still have limited Cloud controls. |
| ElevenLabs and Gemini | Both have credential setup, model and account voice discovery, Speech, archive, and retry. A live Gemini Flash-Lite request produced Vietnamese WAV audio. Direct ElevenLabs was verified with a mock API. |
| Dialogue | All three share the script, cast, templates, and take history. A live Gemini request produced a two-voice Vietnamese scene. Direct ElevenLabs was verified with a mock API. |
| Current priority | Focus on TTS and the GenVoice library. Further ElevenLabs and Gemini integration is paused. |
| Remaining workflows | The tables below describe provider contracts and integration decisions. Track unimplemented workflows separately. |
| CLI | Run bun run voice:playground schema generate tts for connection and speechStyle. Use status or catalog with connection to inspect configuration and capabilities. |

## Connections

| Service | Configuration and identity |
| --- | --- |
| GenVoice | Set GENVOICE_API_KEY or enter it in the app. ElevenLabs, MiniMax, and CapCut engines share the GenVoice account. |
| ElevenLabs | Set ELEVENLABS_API_KEY or enter it in the app. Direct requests use api.elevenlabs.io. Permissions and quotas depend on the account. |
| Google Gemini | Set GEMINI_API_KEY or GOOGLE_API_KEY, or enter the key in the app. Google Cloud uses ADC or OAuth and a project with the relevant service enabled. |
| Legacy records | A missing connection means GenVoice. For new records, save the connection with the model, voice ID, recipe, cost source, and version. |

## Integration decisions

| Workflow | GenVoice | Direct ElevenLabs | Google Gemini |
| --- | --- | --- | --- |
| Speech and multiple takes | Submit asynchronous TTS and store the charge reported by the task. | Use Text to Dialogue for v4 and Text to Speech for earlier models. Keep word timings and character cost when returned. | Flash and Flash-Lite 3.8 accept delivery directions and return WAV audio and token counts. |
| Voice selection | Browse default, shared, MiniMax, and CapCut voices. | List models and account voices via v2/voices. Adding a public voice requires access to the shared library. | Use the 30 default voices or extended catalog. Accent, locale, and context filters differ from ElevenLabs. |
| Dialogue | Assign a separate engine to each role. | Use one model per request and up to 10 voice IDs over REST. v4 Turbo favors one voice over WebSocket. | Use one request with two built-in voices and per-turn direction. Split requests for more voices, custom voices, or separate tracks. |
| Transcribe | Submit asynchronous Scribe v2 jobs and export transcripts. | Scribe v3/v2 provides word timing, diarization, and model-specific options. Use Forced Alignment separately. | Gemini 3.5 Transcribe returns word offsets and speaker labels. Check the 30-minute limit for timestamps and diarization to avoid truncation. |
| Voice Changer | Apply an ElevenLabs voice to a file or clip. | Direct Voice Changer accepts multipart input. Language support depends on the model, and the current STS documentation omits Vietnamese. | The Gemini documentation does not list an equivalent same-language Voice Changer. |
| Create a voice | Clone with MiniMax and keep the preview and usage permissions. | Design and remix offer sample review. Instant cloning may require verification, and Professional Voice Cloning requires a verified voice owner. | Design, remix, and replicate through the Voices API. Remix and replication require a paid tier, and replication requires a consent sample. |
| Dubbing | Submit a dubbing job and track timing and cost by source. | Dubbing v2 works by project and language. Editing transcripts or regenerating segments requires the relevant entitlement. | Transcribe, translate, synthesize, and assemble tracks for a recorded file. Live Translate uses a separate workflow. |
| Cloud and recovery | History supports TTS, Dialogue, Voice Changer, and Transcribe. Preserve Project and Global scopes when extending support. | History IDs differ from request IDs. Dubbing and speech-to-text use separate APIs. | Speech and transcription use local storage. Creating a custom voice can save it remotely, depending on the operation. |

## Limits and pricing

| Topic | Handling |
| --- | --- |
| Cost | Track GenVoice credits, ElevenLabs credits, and Gemini tokens separately. Show actual charges from the response and mark token- or model-based prices as estimates. |
| Rights | Keep evidence by voice, account, and user. Follow the provider's consent and verification requirements for cloning. |
| Interface | Use the same locations for script, model, voice, archive, favorites, and templates. Show settings by capability and explain why an action is unavailable. |
| Separate integrations | Google Cloud Chirp, SSML/ADC, and speech-to-text through GCS need a separate Cloud connection. Lyria, ElevenLabs Music/SFX, and audio isolation belong in the Sound library. |
| Testing | Use mock APIs to verify requests, data, and UI. Verify account permissions, quotas, and actual output quality with an appropriate key. |

## Official documentation

| Service | Sources |
| --- | --- |
| GenVoice | [API](https://genvoice.pro/llms.txt), [STT Cloud](https://genvoice.pro/docs/stt/list-transcriptions), [Dubbing](https://genvoice.pro/docs/aidubbing/upload-complete) |
| ElevenLabs | [API](https://elevenlabs.io/docs/llms.txt), [Models](https://elevenlabs.io/docs/overview/models), [Cost](https://elevenlabs.io/docs/api-reference/introduction#tracking-generation-costs), [Dubbing](https://elevenlabs.io/docs/api-reference/dubbing/llms.txt), [Terms](https://elevenlabs.io/terms-of-use) |
| Google | [Speech](https://ai.google.dev/gemini-api/docs/speech-generation), [Voices API](https://ai.google.dev/api/voices), [Transcribe](https://ai.google.dev/gemini-api/docs/transcribe), [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [Terms](https://ai.google.dev/gemini-api/docs/terms), [Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/authentication) |
