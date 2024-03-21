---
title: Ros Install (noetic)
date: 2023/12/13
mathjax: true
abstract: 當初老師請我在大教室的電腦上面灌 ROS 時寫的紀錄隨筆
tags: ROS
categories:
- ROS
---

# Ros Install (noetic)

當初老師請我在大教室的電腦上面灌 ROS，因為我當初沒有使用 Ansible 之類的軟體，所以就寫了個 script，每台開起來 clone 下來跑，這是當初的紀錄，也許可以幫到某位有緣人(?

# github

```bash
git clone https://github.com/NcuMathRoboticsLab/MRLRosInstall.git
```

# 手動操作

> 沒有 vim 的話看你要裝還是用 nano

```bash
vim install.sh
```

把下面的內容貼上：

```bash=
#!/bin/bash

sudo apt update
sudo apt upgrade
wget https://raw.githubusercontent.com/ROBOTIS-GIT/robotis_tools/master/install_ros_noetic.sh
chmod 755 ./install_ros_noetic.sh 
bash ./install_ros_noetic.sh

sudo apt-get install ros-noetic-joy ros-noetic-teleop-twist-joy \
  ros-noetic-teleop-twist-keyboard ros-noetic-laser-proc \
  ros-noetic-rgbd-launch ros-noetic-rosserial-arduino \
  ros-noetic-rosserial-python ros-noetic-rosserial-client \
  ros-noetic-rosserial-msgs ros-noetic-amcl ros-noetic-map-server \
  ros-noetic-move-base ros-noetic-urdf ros-noetic-xacro \
  ros-noetic-compressed-image-transport ros-noetic-rqt* ros-noetic-rviz \
  ros-noetic-gmapping ros-noetic-navigation ros-noetic-interactive-markers

sudo apt install ros-noetic-dynamixel-sdk
sudo apt install ros-noetic-turtlebot3-msgs
sudo apt install ros-noetic-turtlebot3

sudo echo "source /opt/ros/noetic/setup.bash" >> ~/.bashrc
sudo echo "source ~/catkin_ws/devel/setup.bash" >> ~/.bashrc
sudo echo "export ROS_MASTER_URI=http://localhost:11311" >> ~/.bashrc
sudo echo "export ROS_HOSTNAME=localhost" >> ~/.bashrc
sudo echo "export TURTLEBOT3_MODEL=burger" >> ~/.bashrc

source ~/.bashrc

cd ~
mkdir catkin_ws
mkdir catkin_ws/src
cd ~/catkin_ws/src

git clone -b noetic-devel https://github.com/ROBOTIS-GIT/DynamixelSDK.git
git clone -b noetic-devel https://github.com/ROBOTIS-GIT/turtlebot3_msgs.git
git clone -b noetic-devel https://github.com/ROBOTIS-GIT/turtlebot3.git
git clone -b noetic-devel https://github.com/ROBOTIS-GIT/turtlebot3_simulations.git

cd ~/catkin_ws && catkin_make
source ~/.bashrc
```

貼上後下：

```bash
chmod +x install.sh
./install.sh
```

過程中會有需要輸入 `Y` 與 enter 的地方

# 測試

## Turtlebot simulator

```bash
export TURTLEBOT3_MODEL=waffle
roslaunch turtlebot3_gazebo turtlebot3_world.launch
```

## SLAM

```bash
roslaunch turtlebot3_gazebo turtlebot3_world.launch
roslaunch turtlebot3_slam turtlebot3_slam.launch slam_methods:=gmapping
roslaunch turtlebot3_teleop turtlebot3_teleop_key.launch
rosrun map_server map_saver -f ~/map
```

## Navigation

> 上面那個要先做完這個才能跑

```bash
roslaunch turtlebot3_gazebo turtlebot3_world.launch
roslaunch turtlebot3_navigation turtlebot3_navigation.launch map_file:=$HOME/map.yaml
```