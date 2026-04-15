# Third-Party Notices

This project includes the following third-party components.

---

## ONNX Runtime Web

- **Version:** 1.24.3
- **Location:** `extension/offscreen/ort/`
- **License:** MIT
- **Copyright:** Copyright (c) Microsoft Corporation

Full license: https://github.com/microsoft/onnxruntime/blob/main/LICENSE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Inter (Typeface)

- **Location:** `extension/fonts/inter-latin.woff2`, `extension/fonts/inter-latin-ext.woff2`
- **License:** SIL Open Font License 1.1
- **Copyright:** Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)

Full license: https://github.com/rsms/inter/blob/master/LICENSE.txt

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is available with a FAQ at: https://openfontlicense.org

---

## Playfair Display (Typeface)

- **Location:** `extension/fonts/playfair-display-*.woff2`
- **License:** SIL Open Font License 1.1
- **Copyright:** Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display)

Full license: https://github.com/clauseggers/Playfair-Display/blob/master/OFL.txt

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is available with a FAQ at: https://openfontlicense.org

---

## Wake Word ONNX Models

- **Location:** `extension/offscreen/models/`
- **Description:** The wake word detection pipeline (`melspectrogram.onnx`, `embedding_model.onnx`, `kiki.onnx`) follows the architecture of the [openWakeWord](https://github.com/dscripka/openWakeWord) project. The `melspectrogram.onnx` and `embedding_model.onnx` feature extractors are derived from openWakeWord's pre-trained models. The `kiki.onnx` classifier was trained specifically for this project.
- **openWakeWord License:** Apache License 2.0
- **Copyright:** Copyright 2022 David Scripka

Full license: https://github.com/dscripka/openWakeWord/blob/main/LICENSE
