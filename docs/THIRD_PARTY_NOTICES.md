# Third-party notices

Media and libraries bundled into rendered videos. The same credits appear in the app at `/legal/credits`.

## Noto Animated Emoji (Google): CC BY 4.0
- Files: `client/src/motion/lottie/emoji/*.json` (15 Lottie files, downloaded 2026-11-16 from `fonts.gstatic.com/s/e/notoemoji/latest/<code>/lottie.json`).
- Licence: Creative Commons Attribution 4.0 International. See https://creativecommons.org/licenses/by/4.0/.
- Attribution: "Noto Animated Emoji by Google, CC BY 4.0." Shown on `/legal/credits`. They are used unmodified and only resized when placed in a video.

## useAnimations (react-useanimations 3.1.1): MIT
- Used for the animated line icons in Motion Explainer scenes. Colours are changed to match each theme.

```
MIT License

Copyright (c) 2018-2026 useAnimations

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
```

## Remotion (remotion, @remotion/*): Remotion License
- Free for individuals and companies of up to 3 people. Larger teams need a Company License (see LAUNCH_CHECKLIST.md).
- `@remotion/transitions` and `@remotion/lottie` (4.0.542) fall under the same licence. Only CSS-based transitions are used; the WebGL ones need an experimental Chrome feature.

## Pixabay Music: Pixabay Content License
- Background music tracks in `<storage>/music`, added by admins from pixabay.com/music. Commercial use is allowed and no attribution is required (https://pixabay.com/service/license-summary/). Each track records its licence in `music.json`.

## lottie-web (via @remotion/lottie): MIT
