# Resources and credits

This is a fan-made Normandy startup concept for DeepSeek Harness. Mass Effect, Normandy, N7, and EDI are references to the Mass Effect setting; this project is not an official EA or BioWare product.

## Libraries and fonts

- Three.js 0.180.0: MIT. Copyright and full license: `dist/vendor/THREE-LICENSE.txt`.
- Michroma: SIL Open Font License 1.1. Full license: `dist/assets/fonts/michroma-OFL.txt`.
- Rajdhani: SIL Open Font License 1.1. Full license: `dist/assets/fonts/rajdhani-OFL.txt`.

## Audio

`dist/cinematic/assets/cinematic.wav` combines synthesized sound effects with locally generated Qwen3-TTS speech. The speech references EDI-style dialogue from the uploader-labelled [EDI_241210 dataset](https://huggingface.co/datasets/Fearnworks/EDI_241210). The original reference recordings and model weights are not part of this repository.

The generated lines are listed in `cinematic-audio.json`, alongside their timing and source hashes. The audio is listed separately from the library and font licenses above; no blanket MIT license is claimed for these recordings.

## Motion reference

The motion study used the HD startup source in [Ar1haraNaN7mI/deepseek-harness-rust-optimize](https://github.com/Ar1haraNaN7mI/deepseek-harness-rust-optimize), inspected at `71dbb7d07d0ef20eaf708f15aca967d1b02bd8fb`. This project's N7 paths, procedural ship, typography layout, timeline, and sound mix are provided in their own source files.
