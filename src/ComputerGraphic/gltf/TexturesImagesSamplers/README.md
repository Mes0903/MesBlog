---
title: glTF：Textures, Images, and Samplers
date: 2025-04-30
tag: 
  - computer-graphic
  - gltf
category: computer-graphic
---

# glTF：Textures, Images, and Samplers

貼圖（Texture）是實現物件擬真外觀（realistic appearance）的一個重要元素，它可以用來定義物件的主顏色，也可以用來描述材質中的其他特性，這些特性能更進一步地定義物體被渲染時應該呈現的樣貌細節

一個 glTF asset 中可以定義多個 [`texture`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-texture) 物件，這些貼圖會在渲染時被用來指定幾何物件的材質屬性，例如 base color、metallic、roughness 等。 實際進行貼圖時，根據不同的圖形 API（如 WebGL、OpenGL），會有很多參數與行為會影響貼圖的映射方式。這些細節大多超出本教學的範圍，若想深入理解，建議參考以下教學資源：

- [webglfundamentals.org](https://webglfundamentals.org/webgl/lessons/webgl-3d-textures.html)
- [open.gl](https://open.gl/textures)

本節只會簡要說明 glTF 中貼圖的定義方式

在 glTF 的 JSON 檔中，與貼圖相關的資訊主要由三個頂層陣列組成：

- `textures`：定義貼圖本體
- `images`：定義實際圖檔來源
- `samplers`：定義貼圖的取樣與映射方式

每個陣列分別包含：

-  [`texture`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-texture) 物件
- [`sampler`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#_texture_sampler) 物件
- [`image`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-image) 物件

以下是下一節 Simple Texture 範例中的片段：

```javascript
"textures": [
  {
    "source": 0,
    "sampler": 0
  }
],
"images": [
  {
    "uri": "testTexture.png"
  }
],
"samplers": [
  {
     "magFilter": 9729,
     "minFilter": 9987,
     "wrapS": 33648,
     "wrapT": 33648
   }
],
```

`textures` 裡的貼圖物件透過 `source` 的索引指向 images 陣列中的圖像資源，並透過 `sampler` 的索引指向一個 `sampler` 物件，定義其取樣與包裹行為。 其中最關鍵的是 `image` 中的 URI，這個 URI 指向實際的圖檔（例如 PNG、JPG），渲染器會根據它載入圖片作為貼圖來源。

至於貼圖資料是如何讀入的，可以參考第二章中 image data in `images` 一節的說明。 下一章會說明如何在材質中實際使用這些貼圖設定，這樣就能為物件套用更具細節與寫實感的外觀表現了
