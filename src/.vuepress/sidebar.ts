import { sidebar } from "vuepress-theme-hope";

export default sidebar([
  "/",
  {
    text: "雜項",
    collapsible: true,
    children: [
      {
        text: "網路",
        collapsible: true,
        prefix: "/computer_network/",
        children: [
          "GSM_UMTS_IGP/",
        ],
      },
      {
        text: "memory",
        collapsible: true,
        prefix: "/memory/",
        children: [
          "sw_reram/",
          "memory_model/",
        ],
      },
      {
        text: "ROS",
        collapsible: true,
        prefix: "/ROS/",
        children: [
          "ROS_Install/",
          "ROS_Tutorial_Introduction/",
        ],
      },
      {
        text: "security",
        collapsible: true,
        prefix: "/security/",
        children: [
          "PE_file_format/",
        ],
      }
    ],
  },
  {
    text: "Cpp-Miner",
    collapsible: true,
    children: [
      "Cpp-Miner/",
      {
        text: "Miner 新手教學",
        collapsible: true,
        prefix: "/Cpp-Miner/Miner_Tutorial/",
        children: [
          "Computer_Introduction/",
          "Environment_Building/",
          "Object_Expression_Statement/",
          "Array_Pointer/",
          "Function_Memory/",
          "Class/",
          "OO/",
        ]
      },
      {
        text: "Miner 本篇",
        collapsible: true,
        prefix: "/Cpp-Miner/Miner_main/",
        children: [
          "",
          "Value_Categories/",
          "malloc_new_POD/",
          "Std_Function/",
          "Structured_Binding/",
          "Concept_SFINAE_DetectionIdiom/",
          "Dependent_Name/",
          "Allocator_PMR/",
        ]
      },
      {
        text: "Miner 黑魔法",
        collapsible: true,
        prefix: "/Cpp-Miner/Miner_BlackMagic/",
        children: [
          "NoConst/",
          "Explicit_Detect_Copy/",
          "SSO/",
          "Indirect_through_null_pointer/",
        ]
      }
    ],
  },
  {
    text: "risc-v",
    collapsible: true,
    prefix: "/risc-v/",
    children: [
      "OSDI/",
      "risc-v-note/",
      "Machine-Level-ISA/",
      "Supervisor-Level-ISA/",
      "ACLINT/",
      "PLIC/",
      "rv32emu-Introduction/",
    ],
  },
  {
    text: "Linux",
    collapsible: true,
    prefix: "/Linux/",
    children: [
      "The_mind_behind_Linux/",
      "physical_address_syscall/",
      "qemu_kernel_module/",
      "linux-graphic-stack/",
    ],
  },
  {
    text: "Computer Graphic",
    collapsible: true,
    prefix: "/ComputerGraphic/",
    children: [
      {
        text: "GAMES101",
        collapsible: true,
        prefix: "/ComputerGraphic/GAMES101/",
        children: [
          "HomogeneousCoordinates/",
          "MVPTransformation/",
          "Rasterization/",
          "Shading/",
        ]
      },
      {
        text: "GAMES105",
        collapsible: true,
        prefix: "/ComputerGraphic/GAMES105/",
        children: [
          "CharacterKinematicsAndKeyframeAnimation/",
        ]
      },
      {
        text: "Gltf Tutorial",
        collapsible: true,
        prefix: "/ComputerGraphic/gltf/",
        children: [
          "",
          "Introduction/",
          "BasicGltfStructure/",
          "MinimalGltfFile/",
          "ScenesNodes/",
          "BuffersBufferViewsAccessors/",
          "SimpleAnimation/",
          "Animations/",
          "SimpleMeshes/",
          "Meshes/",
          "Materials/",
          "SimpleMaterial/",
          "TexturesImagesSamplers/",
          "SimpleTexture/",
          "AdvancedMaterial/",
          "SimpleCameras/",
          "Cameras/",
          "SimpleMorphTarget/",
          "MorphTargets/",
          "SimpleSkin/",
          "Skins/",
        ]
      },
      {
        text: "其他",
        collapsible: true,
        children: [
          "glfwInputGuide/",
        ]
      },
    ],
  },
  {
    text: "OS",
    collapsible: true,
    children: [
      {
        text: "清大周志遠 OS",
        collapsible: true,
        prefix: "/OS/NTHU/",
        children: [
          "",
          "Introduction/",
          "OS-Structured/",
          "Process-Concept/",
        ]
      },
      {
        text: "OSTEP",
        collapsible: true,
        children: [
          {
            text: "Virtualization",
            collapsible: true,
            prefix: "/OS/OSTEP/Virtualization/",
            children: [
              "18/",
              "19/",
              "20/",
              "21/",
              "22/",
              "23/",
            ]
          },
          {
            text: "Concurrency",
            collapsible: true,
            prefix: "/OS/OSTEP/Concurrency/",
            children: [
              "26/",
              "27/",
              "28/",
              "29/",
              "30/",
              "31/",
              "32/",
              "33/",
            ]
          },
          {
            text: "Persistence",
            collapsible: true,
            prefix: "/OS/OSTEP/Persistence/",
            children: [
              "36/",
              "37/",
              "38/",
              "39/",
              "40/",
              "41/",
            ]
          },
        ]
      },
      {
        text: "xv6 riscv book 繁體中文翻譯",
        collapsible: true,
        prefix: "/OS/xv6-riscv-book-zh-TW/",
        children: [
          "",
          "chapter1/",
          "chapter2/",
          "chapter3/",
          "chapter4/",
          "chapter5/",
          "chapter6/",
          "chapter7/",
          "chapter8/",
          "chapter9/",
        ]
      },
    ],
  },
  {
    text: "數值線代",
    collapsible: true,
    prefix: "/numerical_algebra/",
    children: [
      "Norm/",
      "Gauss-Seidel/",
      "Relaxation/",
      "Error-Bound/",
      "Gradient-method/",
      "Conjugate-Gradient/",
      "Least-Squares/",
      "Polynomials-of-Least-square/",
      "Linear-Algebra-and-Eigenvalues/",
      "Power-Method/",
    ],
  },
  {
    text: "雜記",
    collapsible: true,
    prefix: "/essay/",
    children: [
      "AboutMovingForward/",
      "RasterI/",
      "ShionGraduate/",
      "FeelWithTheHeart/",
      "AboutTranslation/"
    ],
  },
]);
