---
title: 關於我
icon: user
article: false
timeline: false
---

安安我是 Mes，來自臺灣，曾就讀於國立中央大學數學系，後來轉學到臺師大資工系，目前仍是大學生。 你也可以在 [GitHub](https://github.com/Mes0903) 和 [LinkedIn](https://www.linkedin.com/in/yung-tse-cheng/) 找到我

我非常喜歡 C++，受到 TCCPP 論壇的鼓舞，我現在仍在持續研讀 C++ 的規格書，希望之後能參加 wg21 的會議，期許有一天能成為 C++ 委員會的一員

我之前在國立中央大學數學系的計算機中心擔任了一年的網管，那段期間，我和另一位網管一起利用 Proxmox VE 從零建起了我們的伺服器叢集，我現在也偶爾還會回計中幫忙處理一些伺服器相關的問題。 另外，我也仍會幫忙主持計中舉辦的讀書會

在卸任網管後，我便回去繼續研讀自己比較感興趣的主題了，這主要有系統軟體、計算機圖學與程式語言理論這三個部份。 另外，由於個人的習慣與興趣，我也時常會做一些翻譯

我的夢想是做遊戲機，為此我也仍在努力學習英文與日文，希望未來可以到如任天堂、Sony 或是 Valve 等公司參與遊戲機的開發

## 工作經驗

- 系統與網路管理員（Systems and Network Manager）
  - 2023 年 7 月至 2024 年 6 月
  - 擔任國立中央大學數學系的系統與網路管理員。 期間負責帶領高等教育深耕計畫的學生團隊，維護系上的網頁服務與伺服器叢集，並開發新的系統
  - 將原本以 Kubernetes 為基礎的服務遷移至 Proxmox VE 與 Docker，重建系上的伺服器叢集
- 研究助理（Research Assistant）
  - 2020 年 9 月至 2023 年 6 月
  - 在此期間，我完成了多項高等教育深耕計畫與產學合作計畫，主要專案包括：
    - 教學用機器狗的 IMU（MPU9250）模組開發
    - 開發供資料科學課程學生使用的[標註工具](https://github.com/NcuMathRoboticsLab/MRL_LabelTool)
    - 調整「[子由數學小學堂](https://emath.math.ncu.edu.tw/e_school/)」的題目生成系統，使其相容於閱讀器架構
    - 開發「[子由數學小學堂](https://emath.math.ncu.edu.tw/e_school/)」AI 推薦系統的視覺化分析工具

## 演講

- Open Source Summit North America 2026（Embedded Linux Conference 議程軌）
  - 講題：[Demystifying VirtIO-GPU: Building a Graphics Virtualization Bridge From Scratch](https://osselcna2026.sched.com/event/2JQrw/demystifying-virtio-gpu-building-a-graphics-virtualization-bridge-from-scratch-yung-tse-cheng-national-taiwan-normal-university-sheng-wen-colin-cheng-the-university-of-texas-at-austin)（[投影片](https://github.com/Mes0903/talks/blob/main/OSSNA-2026-talk/OSS-NA26-Talk.pptx)）
  - 以 virtio-gpu 2D 與 GLX 應用程式為例，說明圖形虛擬化的基本架構，以及應用程式啟動後的圖形處理流程，最後介紹 virtio-gpu 3D 增加的圖形加速命令
- COSCUP 2026（System Software 議程軌）
  - 講題：[How a VM Draws Pixels: Mesa, Gallium, and virtio-gpu 3D](https://coscup.org/2026/en/session/N87PMR/)（[投影片](https://github.com/Mes0903/talks/blob/main/coscup-2026-talk/COSCUP-2026-Mesa-vGPU-3D.pptx)）
  - 介紹虛擬機器的圖形輸出如何串接 Mesa、Gallium 與 virtio-gpu 3D
- Open Source Summit Japan 2026
  - 講題：Tracing an OpenGL Frame Through AGL’s Remote VirtIO-GPU Stack
  - 以 AGL Unified HMI 為例，追蹤 OpenGL ES 繪圖命令如何經 Mesa、VirtIO-GPU 與 RVGPU 遠端算繪，並說明 Wayland 的畫面傳遞與 DDFW 的布局控制

## 開源專案

- [Linux 核心修補](https://github.com/torvalds/linux/commit/6af3330ec5d5fb8c06c04eb520a71cf73ea5a765)：修正 virtio-fs 初始化失敗後，清理佇列時可能重複釋放記憶體的問題
- [semu](https://github.com/sysprog21/semu)：能夠執行 Linux 核心的精簡 RISC-V 系統模擬器。 我實作了 VirtIO-GPU 2D／3D 圖形與鍵盤、滑鼠輸入，使用 Linux DRM/KMS、VirGL 與單生產者單消費者事件佇列
- [5568ke](https://github.com/Mes0903/5568ke)：以 C++20 和 OpenGL 製作的 glTF 算繪與動畫實驗專案，包含場景圖、關鍵影格動畫、GPU 蒙皮與 ImGui 播放控制
- [Mase](https://github.com/Mes0903/Mase)：以 C++17、OpenGL 和 ImGui 製作的迷宮產生與路徑搜尋視覺化工具，包含 3 種迷宮產生演算法與 5 種路徑搜尋演算法，其中包括 UCS 與 A*

## 翻譯與寫作

由於單篇的文章翻譯散落於 Blog 中，並沒有額外開一個 repo 出來，所以這邊僅列出書籍與系列文的翻譯

- [Cpp-Miner](https://github.com/Mes0903/Cpp-Miner)
  - 我撰寫的 C++ 教學系列，介紹 C++ 標準中的術語與現代 C++ 功能
- [Operating System in 1,000 Lines](https://github.com/nuta/operating-system-in-1000-lines) 繁體中文翻譯
  - 一本從零開始打造小型作業系統的教學
- [xv6-riscv-book](https://github.com/Mes0903/xv6-riscv-book-zh-TW)
  - xv6 RISC-V 書籍的繁體中文翻譯，原書是 MIT 6.828 與 6.1810 的課堂教材
- [glTF Tutorial](https://github.com/Mes0903/glTF-Tutorials-zh-TW)
  - Khronos Group 所寫的 [glTF Tutorial](https://github.com/KhronosGroup/glTF-Tutorials) 的繁體中文翻譯與筆記
