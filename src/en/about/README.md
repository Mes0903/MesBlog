---
title: About Me
icon: user
article: false
timeline: false
---

<!-- markdownlint-disable-file MD013 -->

Hi, I'm Mes from Taiwan. I studied mathematics at National Central University before transferring to the Department of Computer Science and Information Engineering at National Taiwan Normal University, where I'm still an undergraduate. You can also find me on [GitHub](https://github.com/Mes0903) and [LinkedIn](https://www.linkedin.com/in/yung-tse-cheng/).

I love C++. Inspired by the TCCPP forum, I continue to study the C++ standard. I hope to attend WG21 meetings and eventually become a member of the C++ committee.

I spent a year as a systems and network manager at the Computing Center of National Central University's Department of Mathematics. Another administrator and I built our server cluster from scratch with Proxmox VE. I still return occasionally to help with server issues and host the center's study group.

After stepping down, I returned to the topics that interest me most: system software, computer graphics, and programming language theory. I also translate technical material from time to time.

My dream is to build game consoles. I'm still working on my English and Japanese, and I hope to help develop consoles at Nintendo, Sony, or Valve one day.

## Work Experience

- Systems and Network Manager
  - July 2023–June 2024
  - At National Central University's Department of Mathematics, I led a student team working on Higher Education Sprout projects, maintained the department's web services and server cluster, and developed new systems.
  - Migrated services from Kubernetes to Proxmox VE and Docker, rebuilding the department's server cluster.
- Research Assistant
  - September 2020–June 2023
  - Completed several Higher Education Sprout and industry collaboration projects, including:
    - Developing an IMU (MPU9250) module for an educational robot dog
    - Building a [labeling tool](https://github.com/NcuMathRoboticsLab/MRL_LabelTool) for data science students
    - Adjusting the question generation system of "[Ziyou Math Elementary School](https://emath.math.ncu.edu.tw/e_school/)" to work with its reader architecture
    - Building a visualization tool for the AI recommendation system of "[Ziyou Math Elementary School](https://emath.math.ncu.edu.tw/e_school/)"

## Talks

- Open Source Summit North America 2026 (Embedded Linux Conference track)
  - Talk: [Demystifying VirtIO-GPU: Building a Graphics Virtualization Bridge From Scratch](https://osselcna2026.sched.com/event/2JQrw/demystifying-virtio-gpu-building-a-graphics-virtualization-bridge-from-scratch-yung-tse-cheng-national-taiwan-normal-university-sheng-wen-colin-cheng-the-university-of-texas-at-austin) ([Slides](https://github.com/Mes0903/talks/blob/main/OSSNA-2026-talk/OSS-NA26-Talk.pptx))
  - Used virtio-gpu 2D and a GLX application to explain the graphics virtualization stack, then introduced the commands virtio-gpu 3D adds for graphics acceleration.
- COSCUP 2026 (System Software track)
  - Talk: [How a VM Draws Pixels: Mesa, Gallium, and virtio-gpu 3D](https://coscup.org/2026/en/session/N87PMR/) ([Slides](https://github.com/Mes0903/talks/blob/main/coscup-2026-talk/COSCUP-2026-Mesa-vGPU-3D.pptx))
  - Explained how a VM's graphics output passes through Mesa, Gallium, and virtio-gpu 3D.
- Open Source Summit Japan 2026
  - Talk: Tracing an OpenGL Frame Through AGL’s Remote VirtIO-GPU Stack
  - Using AGL Unified HMI as an example, traced OpenGL ES draw calls through Mesa, VirtIO-GPU, and RVGPU for remote rendering, then explained Wayland's buffer transfer and DDFW's layout control.

## Open Source Projects

- [Linux kernel patch](https://github.com/torvalds/linux/commit/6af3330ec5d5fb8c06c04eb520a71cf73ea5a765): Cleared freed virtio-fs queue pointers after a failed setup to prevent a double-free during probe cleanup.
- [semu](https://github.com/sysprog21/semu): A minimal RISC-V system emulator capable of running Linux. I implemented VirtIO-GPU 2D/3D graphics and keyboard/mouse input using Linux DRM/KMS, VirGL, and a single-producer, single-consumer event queue.
- [5568ke](https://github.com/Mes0903/5568ke): A C++20/OpenGL glTF renderer and animation sandbox with scene graphs, keyframe animation, GPU skinning, and ImGui playback controls.
- [Mase](https://github.com/Mes0903/Mase): A C++17/OpenGL/ImGui visualizer with three maze generators and five pathfinding algorithms, including UCS and A*.

## Translation and Writing

Shorter article translations are scattered throughout the blog, so this section highlights longer translations and writing series.

- [Cpp-Miner](https://github.com/Mes0903/Cpp-Miner)
  - My C++ tutorial series on terminology from the C++ standard and modern language features
- [Operating System in 1,000 Lines](https://github.com/nuta/operating-system-in-1000-lines) Traditional Chinese translation
  - A guide to building a small operating system from scratch
- [xv6-riscv-book](https://github.com/Mes0903/xv6-riscv-book-zh-TW)
  - My Traditional Chinese translation of the xv6 RISC-V book used in MIT 6.828 and 6.1810
- [glTF Tutorial](https://github.com/Mes0903/glTF-Tutorials-zh-TW)
  - My Traditional Chinese translation and notes for the [glTF Tutorial](https://github.com/KhronosGroup/glTF-Tutorials) by the Khronos Group
