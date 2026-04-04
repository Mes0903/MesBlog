---
title: glTF：Cameras
date: 2025-05-01
tag: 
  - computer-graphic
  - gltf
category: computer-graphic
---

# glTF：Cameras

在前一章 Simple Cameras 中，我們已經看到如何在 glTF 中定義透視相機（perspective camera）和正交相機（orthographic camera），以及如何將這些相機掛載（attach）到節點來整合進場景中了，本節將進一步說明兩種相機的差異與一般相機的處理方式

## Perspective and orthographic cameras

glTF 中有兩種相機類型：

- 透視相機（Perspective）：其視體積（viewing volume）為一個截去頂部的錐體（truncated pyramid），通常稱作視錐體（viewing frustum）
- 正交相機（Orthographic）：其視體積為一個矩形盒子（rectangular box）

主要的差異在於，透視相機會產生「透視失真」，也就是距離越遠的物體看起來越小，而正交相機則會保留長度與角度，遠近物體大小一致

在 Simple Cameras 中，我們定義了一個透視相機（索引 0）與一個正交相機（索引 1）：

```javascript
"cameras" : [
  {
    "type": "perspective",
    "perspective": {
      "aspectRatio": 1.0,
      "yfov": 0.7,
      "zfar": 100,
      "znear": 0.01
    }
  },
  {
    "type": "orthographic",
    "orthographic": {
      "xmag": 1.0,
      "ymag": 1.0,
      "zfar": 100,
      "znear": 0.01
    }
  }
],
```

The `type` of the camera is given as a string, which can be `"perspective"` or  `"orthographic"`. Depending on this type, the `camera` object contains a [`camera.perspective`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-camera-perspective) object or a [`camera.orthographic`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-camera-orthographic) object. These objects contain additional parameters that define the actual viewing volume.

The `camera.perspective` object contains an `aspectRatio` property that defines the aspect ratio of the viewport. Additionally, it contains a property called `yfov`, which stands for *Field Of View in Y-direction*. It defines the "opening angle" of the camera and is given in radians.

The `camera.orthographic` object contains `xmag` and `ymag` properties. These define the magnification of the camera in x- and y-direction, and basically describe the width and height of the viewing volume.

Both camera types additionally contain `znear` and `zfar` properties, which are the coordinates of the near and far clipping plane. For perspective cameras, the `zfar` value is optional. When it is missing, a special "infinite projection matrix" will be used.

Explaining the details of cameras, viewing, and projections is beyond the scope of this tutorial. The important point is that most graphics APIs offer methods for defining the viewing configuration that are directly based on these parameters. In general, these parameters can be used to compute a *camera matrix*. The camera matrix can be inverted to obtain the *view matrix*, which will later be post-multiplied with the *model matrix* to obtain the *model-view matrix*, which is required by the renderer.

`type` 欄位用字串 `"perspective"` 或 `"orthographic"` 指定相機類型

對於 `"perspective"` 相機：

- `aspectRatio` 表示畫面寬高比
- `yfov` 是垂直視角（以弧度為單位）

對於 `"orthographic"` 相機：

- `xmag` / `ymag` 定義橫向與縱向的放大倍率，可視為視體積的寬與高。

此外，兩種相機都需要定義 `znear`（近平面）與 `zfar`（遠平面），不過對於透視相機而言，`zfar` 是可選的，若省略，則視為使用「無限遠投影矩陣」

這些相機參數對應到大多數圖形 API 中的攝影機設定函式，因此可直接用來建立投影矩陣（projection matrix），再與 model matrix 結合形成最終的 model-view-projection（MVP） 矩陣

# Camera orientation

A `camera` can be transformed to have a certain orientation and viewing direction in the scene. This is accomplished by attaching the camera to a `node`. Each [`node`](https://www.khronos.org/registry/glTF/specs/2.0/glTF-2.0.html#reference-node) may contain the index of a `camera` that is attached to it. In the simple camera example, there are two nodes for the cameras. The first node refers to the perspective camera with index 0, and the second one refers to the orthographic camera with index 1:

相機的「位置」與「朝向」是透過將相機綁定到某個 `node` 來實現的，每個 node 都可以指定 camera 屬性，對應到 `cameras` 陣列中的 index

舉例來說：

```javascript
"nodes" : {
  ...
  {
    "translation" : [ 0.5, 0.5, 3.0 ],
    "camera" : 0
  },
  {
    "translation" : [ 0.5, 0.5, 3.0 ],
    "camera" : 1
  }
},
```

這代表兩個節點分別綁定了索引 0（透視）與索引 1（正交）相機，且都被平移到了 `(0.5, 0.5, 3.0)` 的位置。 如同 Scenes and Nodes 一章中所提到的，節點的 transform（TRS 或 matrix）會構成 global transform，並影響相機在場景中的實際位置與朝向

若相機所在的節點沒有任何 transform，則預設情況下相機會放在原點，且視線方向是沿著負 z 軸（即 `[0, 0, -1]` 方向看過去）。 透過節點設定，你甚至可以利用動畫來讓移動相機鏡頭（camera flight）

## Camera instancing and management

glTF 中可以定義多個 camera，每個 camera 可被多個 node 引用，因此 glTF 中的 camera 比較像是「模板」，而 實際的 camera 實例則由 node 的引用來建立

glTF 並不會指定預設的相機，客戶端的應用程式需要自行決定要啟用哪個相機，你可以實作下拉選單讓使用者選擇特定相機，或實作自訂 camera 控制方式（如滑鼠滾輪縮放、右鍵拖曳移動等）

不過需要注意的是，這些互動行為並不屬於 glTF 的定義範疇，完全取決於你怎麼實作，像圖 15a 就展示了切換內建相機與外部自訂相機的效果。 前者來自 glTF 內部定義，後者由應用程式提供互動控制
