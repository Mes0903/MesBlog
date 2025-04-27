---
title: glTF：glTF Tutorial
date: 2025-04-24
tag: 
  - computer-graphic
  - gltf
category: computer-graphic
---

# glTF：glTF Tutorial

本系列是 KhronosGroup 所寫的 [glTF-Tutorials](https://github.com/KhronosGroup/glTF-Tutorials) 的中文翻譯與筆記

原作者為 Marco Hutter, [@javagl](https://github.com/javagl)

本教學介紹了 [glTF](https://www.khronos.org/gltf), 概述了 glTF 最重要的功能與應用案例，並說明了與 glTF 相關的檔案結構，解釋了 glTF 資產是如何被讀取、處理，並有效地用來顯示 3D 圖形的

本教學假設你已具備一些 [JSON](https://json.org/)（JavaScript 物件表示法）的基本知識。 此外，也需要對常見的圖形 API（例如 OpenGL 或 WebGL）有基本的了解。 這份教學的重點放在 [glTF version 2.0](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html)，該版本首次引入了 基於物理的渲染（Physically Based Rendering）支援，但本教學中說明的其他概念也與 [glTF version 1.0](https://github.com/KhronosGroup/glTF/tree/main/specification/1.0) 中的實作方式相似

底下為原文各章節的連結：

- [Introduction](gltfTutorial_001_Introduction.md)
- [Basic glTF Structure](gltfTutorial_002_BasicGltfStructure.md)
- [Example: A Minimal glTF File](gltfTutorial_003_MinimalGltfFile.md)
- [Scenes and Nodes](gltfTutorial_004_ScenesNodes.md)
- [Buffers, BufferViews, and Accessors](gltfTutorial_005_BuffersBufferViewsAccessors.md)
- [Example: A Simple Animation](gltfTutorial_006_SimpleAnimation.md)
- [Animations](gltfTutorial_007_Animations.md)
- [Example: Simple Meshes](gltfTutorial_008_SimpleMeshes.md)
- [Meshes](gltfTutorial_009_Meshes.md)
- [Materials](gltfTutorial_010_Materials.md)
- [Example: A Simple Material](gltfTutorial_011_SimpleMaterial.md)
- [Textures, Images, and Samplers](gltfTutorial_012_TexturesImagesSamplers.md)
- [Example: A Simple Texture](gltfTutorial_013_SimpleTexture.md)
- [Example: An Advanced Material](gltfTutorial_014_AdvancedMaterial.md)
- [Example: Simple Cameras](gltfTutorial_015_SimpleCameras.md)
- [Cameras](gltfTutorial_016_Cameras.md)
- [Example: A Simple Morph Target](gltfTutorial_017_SimpleMorphTarget.md)
- [Morph Targets](gltfTutorial_018_MorphTargets.md)
- [Example: Simple Skin](gltfTutorial_019_SimpleSkin.md)
- [Skins](gltfTutorial_020_Skins.md)

**Acknowledgements:**

- Patrick Cozzi, Cesium, [@pjcozzi](https://twitter.com/pjcozzi)
- Alexey Knyazev, [@lexaknyazev](https://github.com/lexaknyazev)
- Sarah Chow, [@slchow](https://github.com/slchow)