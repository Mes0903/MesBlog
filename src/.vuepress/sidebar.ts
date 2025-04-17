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
        ]
      },
      {
        text: "Miner 黑魔法",
        collapsible: true,
        prefix: "/Cpp-Miner/Miner_BlackMagic/",
        children: [
          "",
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
      "ACLINT/",
      "PLIC/",
      "Supervisor-Level-ISA/",
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
        prefix: "/OS/OSTEP/",
        children: [
          {
            text: "Paging",
            collapsible: true,
            prefix: "/OS/OSTEP/paging/",
            children: [
              "18/",
              "19/",
              "20/"
            ]
          }
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
      "ShionGraduate/"
    ],
  },
]);
