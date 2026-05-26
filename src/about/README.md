---
title: 關於我
icon: user
article: false
timeline: false
---

哈囉！我是 Mes，來自臺灣，曾就讀於國立中央大學的數學系，後來轉學到了臺師大的資工系，目前還是大學生

我非常喜歡 C++，受到 TCCPP 論壇的鼓舞，我現在仍在持續研讀 C++ 的規格書，並參加 wg21 的會議，希望有一天能成為 C++ 委員會的一員

我之前在國立中央大學數學系的計算機中心擔任了一年的網管，那段期間，我和另一位網管一起利用 Proxmodx 從零建起了我們的伺服器叢集，我現在也偶爾還會回計中幫忙處理一些伺服器相關的問題。 另外，我也仍會幫忙主持計中舉辦的讀書會

在卸任網管後，我便回去繼續研讀自己比較感興趣的主題了，這主要有系統軟體、計算機圖學與程式語言理論這三個部份。 另外，由於個人的習慣與興趣，我也時常會做一些翻譯

我的夢想是做遊戲機，為此我也仍在努力學習英文與日文，希望未來可以到如任天堂、Sony 或是 Valve 等公司參與遊戲機的開發

## 工作經驗

- 系統與網路管理員（System And Network Manager）
  - 2023 年 7 月 ~ 2024 年 6 月
  - 擔任國立中央大學數學系的系統與網路管理員。期間負責帶領高等教育深耕計畫的學生團隊，維護系上的網頁服務與伺服器叢集，並開發新的系統
  - 由於既有系統存在長期累積的 legacy 問題，我重新建構了整個系所的伺服器叢集基礎設施，將原本相對難以維護、基於 Kubernetes 的架構，遷移至以 Proxmox VE 與 Docker 為核心、較容易維護的新架構
- 研究助理（Research Assistant）
  - 2020 年 9 月 ~ 2023 年 6 月
  - 在此期間，我完成了多項高等教育深耕計畫與產學合作計畫，主要專案包括：
    - 教學用機器狗的 IMU（MPU9250）模組開發
    - 提供資料科學課程學生使用的[標註工具（label tool）](https://github.com/NcuMathRoboticsLab/MRL_LabelTool)開發
    - 調整「[子由數學小學堂](https://emath.math.ncu.edu.tw/e_school/)」的題目生成系統，使其相容於閱讀器架構
    - 開發「[子由數學小學堂](https://emath.math.ncu.edu.tw/e_school/)」AI 推薦系統的視覺化分析工具

## 演講

- OSS-NA 2026：[Demystifying VirtIO-GPU: Building a Graphics Virtualization Bridge From Scratch](https://osselcna2026.sched.com/event/2JQrw/demystifying-virtio-gpu-building-a-graphics-virtualization-bridge-from-scratch-yung-tse-cheng-national-taiwan-normal-university-sheng-wen-colin-cheng-the-university-of-texas-at-austin?iframe=no)  
  以 virtio-gpu 2D 為例，講解了 virtio-gpu 的基礎架構，並以一個 glx 應用程式為例，帶大家逐步理解一個應用程式被開啟時會做哪些事，最後簡介了 virtio-gpu 3D 為了做圖形加速所帶來的額外命令

## 開源專案

- [semu](https://github.com/sysprog21/semu)：一個精簡的 RISC-V 系統模擬器，能夠運行 Linux 核心

## 翻譯與寫作

由於單篇的文章翻譯散落於 Blog 中，並沒有額外開一個 repo 出來，所以這邊僅列出書籍與系列文的翻譯

- [Cpp-Miner](https://github.com/Mes0903/Cpp-Miner)
  - 我寫的 C++ 的教學
- [OS in 1,000 Lines](https://github.com/nuta/operating-system-in-1000-lines) 繁體中文翻譯
  - 一本教你從零開始打造一個小型作業系統的書
- [xv6-riscv-book](https://github.com/Mes0903/xv6-riscv-book-zh-TW)
  - MIT 6.828 及 6.1810 用來解釋 xv6 課堂教材
- [glTF Tutorial](https://github.com/Mes0903/glTF-Tutorials-zh-TW)
  - KhronosGroup 所寫的 [glTF-Tutorials](https://github.com/KhronosGroup/glTF-Tutorials) 的中文翻譯與筆記
