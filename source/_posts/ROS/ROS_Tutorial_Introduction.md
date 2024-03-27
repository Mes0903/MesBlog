---
title: ROS Tutorial Introduction
date: 2021/11/17
mathjax: true
description: 中央大學數學系上課所用的 ROS 教材，原文放在 hackmd 上，我會不定期更新過來
tags: ROS
categories:
- ROS
---

# ROS Tutorial Introduction

此篇為中央大學數學系上課所用的 ROS 教材，若非修課生，Demo 部分需要注意一下自己的機器人設定。 原文放在 hackmd 上，我會不定期更新過來，若發現教材有誤，歡迎到 [hackmd](https://hackmd.io/@Mes/RosTutorial_Intro) 上修改，或是可以發 issue 給我。

# 什麼是 ROS?

ROS 全名叫 Robot Operating System，但它其實是一種中介軟體(Middleware)，妳也可以說它是一個軟體框架(Software Framework)，所以他是一種抽象化的概念，不是應用程式，也不是作業系統。

那它主要會幫我們連結各個軟體和零件之間的溝通，並且會提供一些 logging 的工具，那機器人的中介軟體有很多，像是 ROS、JAUS、Mira 等等。

<center><img src = "https://i.imgur.com/k8TcI4D.png" width="200px"></center>

# 為什麼需要 ROS?

## 最一開始的狀況

最一開始大家都各寫各的，但要寫機器人是一件非常困難的事，妳需要熟知如何撰寫每種零件的 code，當然，有大神克服了，完成了很多作品。

然而當日子一久，機器人技術的規模和範圍不斷擴大，零件也越來越多，此時前面那位大神的 code 在別人手上可能就跑不起來了，因為零件不同。

這會造成一個問題，就算是同樣的功能的 code，由於每個人的零件不同，所以都還要再重寫一次，這就導致了代碼的重用性很低(重造輪子)，而且這類 code 的規模很大，而且還是需要從驅動層級開始寫的，因此非常不方便，且需要非常高的專業能力。

## 框架

因此就有人提出了框架的想法，什麼是框架? 框架是一種規則(思想)，其實就是某種半成品，框架提供了一個基礎的架構，就好像房子的地基和骨架一樣，必須配合妳自己寫的 code 才能生出一個完整的應用程式。

好處就是整個結構可以被<span class ="yellow">重複使用</span>，如果有了框架，那麼做東西就不需要再從頭建造了。

而前面也提到 ROS 算是一種軟體框架，ROS 幫我們把硬體與軟體之間的溝通都做好了，我們只需要寫我們「溝通的過程/效用」就好，而不用再從「溝通的原理」開始寫，也因此我們可以專注於開發演算法及其應用，同時也降低了高度專業能力的限制。

# ROS 的架構

## Peer to peer (P2P)
    
ROS 主要是依靠 P2P 架構實作的，講這個之前先讓大家稍微理解一下簡單的主從式架構：
    
<center><img src = "https://i.imgur.com/O1BI78m.png">    
image source：<a href = "https://en.wikipedia.org/wiki/Client%E2%80%93server_model">wikipedia</a></center><br>
    
客戶端(clients) 會去向伺服器請求資料，這邊這個伺服器裡面有很多資料，像是客戶的帳密、金額，或是你遊戲帳號裡面的寶物有哪些之類的。以早期的線上遊戲來說，每次客戶端有更改資料的動作時都會發送一個請求(request) 給伺服器，假設你打了怪，賺到了 10 元，它就會把這個資訊送到伺服器上，伺服器就會幫你記錄下來；
    
而如果拿網頁舉例子，像是 FB，妳點了某個人的個人頁面，妳就會向伺服器發送一個請求(request)，伺服器收到這個請求後就會知道妳要進入這個人的個人頁面，因此將妳導向這個人的個人頁面，妳就成功進去了。
    
因此伺服器的權限非常的大，並且可以處理非常多的東西。
    
但這會有一個問題，那就是如果發送請求的人非常多，且請求發送的非常頻繁，那麼伺服器的速度可能就會變得非常慢，甚至當機掛掉，DDoS 的原理就是這樣。
    
那如果 ROS 使用了主從式架構，很有可能也會有類似的問題，因此 ROS 使用的是 Peer-To-Peer (一種分散式系統架構)，Middleware 通常都會是分散式系統架構：
    
<center><img src = "https://i.imgur.com/0gatiFI.png">
image source：<a href = "https://ithelp.ithome.com.tw/articles/10216158">link</a></center><br>
    
在這種架構下，每台電腦(節點)都同時是客戶端與伺服器端，所有人都負責儲存了全部或部分的所有資料，並且也都會處理收到的請求。
    
這樣做的優點是能夠擁有很好的平行處理能力，效能也會比較好，缺點是如果規模太大整個網路會很亂，且會很吃網路，但因為機器人的網路規模通常很小，所以不太會有這個問題，另一個缺點就是安全性，如果沒有做特別的處理，傳輸的文件可能會被動手腳，或是失真。
    
那 p2p 有一些變型，這邊舉三個例子，看下面這張圖：
    
<center><img src = "https://i.imgur.com/E6lVVpr.png">
image source：<a href = "https://www.researchgate.net/figure/P2P-architectures-at-a-glance-a-Centralized-architecture-b-Pure-P2P-architecture_fig2_332539196">link</a></center><br>

上面這三個分別為

1. 中心化P2P 
    
    英文為 Centralized P2P architecture
        
    + 有一個中心伺服器來幫忙連結溝通其他節點的訊息資料，並對這些請求做出回應 (但本身並不保存檔案)
    + 節點負責處理、發布訊息資料，讓中心伺服器知道節點需要什麼檔案、資料，讓其他節點下載資源
    + 有 index 可以找到絕對地址
        
    例子像是最初的 Napster
        
2. 純P2P 
    
    英文為 Pure P2P architecture
        
    + 節點同時是客戶端和伺服器端
    + 沒有中心伺服器
        
    例子像是 Gnutella
        
3. 混合型P2P
        
    英文為 Hybrid P2P architecture 
        
    + 有多個伺服器來處理其他節點的訊息資料
    + 同時有上面兩個的特性

    例子像是 Skype
    
    
那麼 ROS 的架構是第一種，Centralized P2P：

<center><img src = "https://i.imgur.com/3Nlo2N7.png">
image source：RSL ROS Tutorial</center><br>

我們會有一片樹梅派來跑 server 的 code，或是像我們一樣用主機來跑 server 的 code，然後各個零件能夠互相傳遞、存取資料。

## 架構及名詞解釋

現在我們已經知道 ROS 是用 P2P 來實作的了，那麼現在我們要來簡單看一下這些東西在 ROS 裡面的名詞及概念。

### Node

在 ROS 裡面，P2P 架構裡面的一個節點我們叫他 Node，Node 是一個你跑起來的程序(Process)，一個完整的系統會有很多個 Node。

一個 Node 通常會是有單一功能的 Process，當然妳一個 Node 要有很多功能也可以，總之核心概念就是模組化(Modular Design)。

舉個例子，一個簡單的導航程式，裡面可能是有一個 Node 是操控雷達，一個 Node 操控馬達、輪子，一個 Node 計算自己的定位(Localization)，一個 Node 來計算路徑規劃，一個 Node 顯示圖形介面，等等。

所以你可以看見它其實就是很多個 Process 組合起來的，那麼這些 code 妳可以用 roscpp 或 rospy 來寫，好像還有其他另外支援的語言套件，但我只熟這兩個了。

### Master

Master 是一個特殊的 Node，也就是我們前面所說的 Server，Master 會幫忙查找 Node，紀錄妳想傳遞的訊息的種類等等。

如果沒有 Master，<span class = "yellow">Node 與 Node 間會找不到對方</span>，妳的資料傳遞、設備呼叫請求等等的溝通就會失效。

### Messages

上面有說一個完整的系統會有很多個 Node，那麼 <span class = "yellow">Node 間要傳遞資料需要靠 Messages 來溝通</span>。

Message 是一種資料結構，裡面會有 type field，type field 通常指的是一個基類(base class) 裡面的變數，這個變數會拿來當作子類的 type 來使用，舉個例子([來源](https://stackoverflow.com/questions/9147101/what-are-type-fields))：

```cpp
#include <iostream>

class Pet {
  public:
    enum PetType { Dog, Cat, Bird, Fish };

    void ToString() const {
        switch ( type ) {
            case PetType::Dog:
                std::cout << "Dog" << std::endl;
                break;
            case PetType::Cat:
                std::cout << "Cat" << std::endl;
                break;
            case PetType::Bird:
                std::cout << "Bird" << std::endl;
                break;
            case PetType::Fish:
                std::cout << "Fish" << std::endl;
                break;
        }
    }

  protected:
    PetType type;    // A type field.
};

class Dog : public Pet {
  public:
    Dog() { type = PetType::Dog; }
};

void Test( const Pet &p ) {
    p.ToString();
}

int main() {
    Dog d;
    Test( d );
    return 0;
}
```

上面的 `Pet::type` 就是一個 type field，在 Dog 這個子類裡面我們用 `type` 來當作了它的型態。

Messeage 裡面可以有標準的基本型態，整數、浮點數、布林值之類的，也可以是基本型態的陣列，且 Message 內可以包含巢狀類(nested class)。

### Topic

Message 在發布時我們會給它加上 Topic，妳可以把 Message 想像成一個箱子，Node 間要傳遞資料時會把資料放到這個箱子裡面，並在這個箱子上面貼上一個標籤，這個標籤就是 Topic。

覺得太抽象的話可以看下面那個小節的圖。

### Publisher & Subscriber 

讓我們先小整理一下，Message 是 Node 間拿來溝通的工具，因此 Message 由 Node 發布，也由 Node 接收。

於是在 ROS 裡面，發布 Message 出來的 Node 我們叫它 Publisher，接收 Message 的 Node 我們叫它 Subscriber，看看下面這張圖：

<center><img src = "https://i.imgur.com/0BAmV13.png"></center><br>

Node 會通過 Topic 來找要接收它需要的訊息，我們稱之為訂閱，例如規劃路徑的 Node 希望和雷達的 Node 拿掃到的資料，那麼規劃路徑的 Node 就是 Subscriber，雷達的 Node 則是 Publisher

而 Message 裡面可能裝很多個整數的陣列，Topic 可能是「雷達資料」，以上方那個圖來說就是：

<center><img src = "https://i.imgur.com/nYVEIcN.png"></center>

而同一種 Topic 的 Message 也可以由不同的 Node 發布，也就是有不同的 Publisher 發布同樣 Topic 的 Message； 例如妳雷達有兩顆，而且妳為他們寫了兩個 Node，那麼這兩個 Node 都可以發布「雷達資料」這種 Topic 的 Message：

<center><img src = "https://i.imgur.com/WpKsU1c.png"></center>

同理，同一種 Topic 的 Message 也可以有不同的 Node 訂閱，有就是有不同的 Subscriber 訂閱同樣 Topic 的 Message； 例如規劃路徑的 Node 需要雷達的資料，建地圖的 Node 也需要雷達的資料，那這兩個 Node 都可以訂閱「雷達資料」這種 Topic 的 Message。

<center><img src = "https://i.imgur.com/YrGKDEq.png"></center>

如果一個 Node 同時在收資料與發資料，那這個 Node 就同時是 Subcriber 與 Publisher。

### 資訊的傳遞

實際上在傳遞資訊時還會需要 Master 來幫忙 Node 之間的通訊，那麼 ROS 的訊息傳送時是使用 TCP/IP 協定的連線，且一旦兩個訊息接起來後就不會再經過 Master 了：

<center><img src = "https://i.imgur.com/I1vVyBH.png"></center>

一開始 Publisher 會先去向 Master 註冊，然後 Publisher 就會開始發布它的訊息(封包)；而當 Subscriber 需要相對應的訊息時就會去詢問 Master，那當它訂閱到那個 Topic 時它們就建立了連線，不再透過 Master 來傳遞資訊。

所以 Master 會負責 Node 之間的通訊，他們之間是 TCP/IP 協定的連線。

而因為 Middleware 會做序列化(Serialization)，所以你 C\+\+ 寫出來的 Node 和 Python 寫出來的 Node 也可以溝通。

### Package

Package 是一個 ROS 軟體的基本單位，Package 會有裡面會有很多個 Node，然後可能會包含有相關的函式庫、資料集(dataset)、配置文件(configuration file)，或其他能幫助你整合、規劃專案的檔案。

換句話說，Package 是妳在建立和發布專案時最基本的單位，因為妳的專案很可能是程式與程式之間在溝通的，妳把那些 Node 整合起來，配合妳自己寫的函式庫，蒐集的資料等等的，整個包裝起來成一個能讓別人使用的程式，這樣的東西就是一個 Package。

# Demo (By OG)

[VB image](https://drive.google.com/file/d/1nWaeKfHHkiT3zIVUx9jwq7ZCGFq6MHf3/view?usp=share_link)

# Ubuntu & Linux

Ubuntu是基於Debian，以桌面應用為主的Linux發行版。Ubuntu有三個正式版本，包括電腦版、伺服器版及用於物聯網裝置和機器人的Core版。前述三個版本既能安裝於實體電腦，也能安裝於虛擬電腦。

## Terminal & CLI

![](https://i.imgur.com/NN2BLPv.png)

### linux 基本指令 ：

cd：用以移動到目標路徑

cp：複製檔案到指定路徑

mv：移動檔案到指定路徑

rm：刪除檔案

ls：顯示當前路徑下的資料夾與檔案

nano：一種CLI的編輯軟體

vim：一種CLI的編輯軟體

### SSH ：

Secure Shell是一種加密的網路傳輸協定，可在不安全的網路中為網路服務提供安全的傳輸環境。SSH通過在網路中建立安全隧道來實現SSH客戶端與伺服器之間的連接。**SSH最常見的用途是遠端登入系統**，人們通常利用SSH來傳輸命令列介面和遠端執行命令。

ssh username@server_location -p port

username：遠端操作時的使用者帳號

server_location：你要連接的電腦，可能是ip或URI

port：ssh 專用的port，預設為22

請注意，接下來開始會有兩台主機進行運作。一台是你的電腦，一台是機器人。
請留意你到底是在哪台機器上操作！！！

# ROS

# roscore & rosrun & roslaunch

在運行node之前都必須先啟動master，master就是ROS系統中負責管理Node的一個功能，他負責node與node之間的溝通橋樑，因此在執行node之前一定要先把master開啟。然後在ros中提供兩種方法去執行你的Node，一種是rosrun、一種是roslaunch。

## [roscore](http://wiki.ros.org/roscore)
roscore可以讓你啟動master
```shell=
roscore
```
## [rosrun](http://wiki.ros.org/rosbash#rosrun) 
rosrun可以讓你去執行特定package下的code，使用方法如下
```shell=
rosrun <package> <executable>
## exaple
rosrun hypharos_minibot main
```
## [roslaunch](http://wiki.ros.org/roslaunch)
roslaunch則透過預先設定的launch file幫你一次開啟很多程式
```shell=
## 因為launch file 是放在某個package底下，還是要加package
roslaunch <package> <launch file>
## example
roslaunch hypharos_minibot project_sample.launch
```

# rosnode & rostopic
在ros中你可以使用以下兩種指令去檢視正在運行的node及topic

* rosnode 動作 參數
* rostopic 動作 參數

## [rosnode](http://wiki.ros.org/rosnode)
在rosnode中提供以下幾種動作可以使用
```shell=
rosnode info <node_name>       #print information about node
rosnode kill <node_name>       #kill a running node
rosnode list                   #list active nodes
rosnode machine <machine-name> #list nodes running on a particular machine or list machines
rosnode ping <node_name>       #test connectivity to node
rosnode cleanup                #purge registration information of unreachable nodes
```
## [rostopic](http://wiki.ros.org/rostopic)
在rostopic中提供以下幾種動作可以使用
```shell=
rostopic bw <topic_name>                          #display bandwidth used by topic
rostopic delay <topic_name>                       #display delay for topic which has header
rostopic echo <topic_name>                        #print messages to screen
rostopic find <msg-type>                          #find topics by type
rostopic hz <topic_name>                          #display publishing rate of topic
rostopic info <topic_name>                        #print information about active topic
rostopic list                                     #print information about active topics
rostopic pub <topic-name> <msg-type> [data...]    #publish data to topic
rostopic type <topic-name>                        #print topic type
```

# 機器人初連接

## Turtlesim
```shell=
# initialize ros master
roscore

# launch turtlesim_node
rosrun turtlesim turtlesim_node

# using keyboard to control the turtle
rosrun turtlesim turtle_teleop_key
```
![](https://i.imgur.com/4tyqX7k.png)

## Minibot & Turtlebot
### 網路設定
筆電網卡設定
**-->ipv4-->ip :10.0.0.2-->mask :255.255.255.0-->store**
```shell=
gedit ~/.bashrc
```

![](https://i.imgur.com/UwIT3Sx.png)

```shell=
source ~/.bashrc
```
![](https://i.imgur.com/cv3fA1X.png)

### 連線
使用新版VM
啟動機器人的指令，一定要在機器人上執行！!!
```shell=
# ssh連接機器人
ssh pi@10.0.0.1 ##passward=mrlrobot
# 假如是minibot下
roslaunch hypharos_minibot project_sample.launch
# 假如是turtlebot下
roslaunch turtlebot3_bringup turtlebot3_robot.launch
```
起動 rviz 視覺化套件
```shell=
rviz
```
遙控機器人
```shell=
#Extra moving !!!
roslaunch teleop teleop_key.launch
```
<!-- ### minibot
```shell=
#ssh連接機器人
ssh pi@10.0.0.1 ##passward=mrlrobot 
roslaunch hypharos_minibot project_sample.launch# 這是啟動機器人的指令，一定要在機器人上執行！！！
```
起動 rviz 視覺化套件
```shell=
rviz
```
遙控機器人
```shell=
#Extra moving !!!
ssh pi@10.0.0.1 ##passward=mrlrobot 
rosrun hypharos_minibot teleop_keyboard.py # 在機器人上執行
```
### turtlebot
```shell=
#ssh連接機器人
ssh pi@10.0.0.1 ##passward=mrlrobot  
roslaunch turtlebot3_sample sample.launch # 這是啟動機器人的指令，一定要在機器人上執行！！！
```
起動 rviz 視覺化套件
```shell=
rviz
```
遙控機器人
```shell=
#Extra moving !!!
roslaunch turtlebot3_teleop turtlebot3_teleop_key.launch
``` -->

### 你一定會遇到的問題

![](https://i.imgur.com/qflqprM.png)

這代表你電腦中儲存的 Key 跟機器人上的不符合，你就執行他提示的指令

`ssh-keygen -f ...` 去把它移除，再重新 ssh

# catkin

## 簡介

catkin 是一個開發環境整合套件，c++ 中的 make 幫我們做到在編譯這個層級做整合。在不使用 IDE 的情況下，我們如果要編譯一個 c code 或一個 c project 時需要手動透過指令執行，而當這你的 code import 的函式庫很多或你的 project 很大時需要輸入的指令就會變得十分的複雜。

此時 make 這個套件就可以讓我們透過設定一個簡單的 makefile 讓編譯器自動地去建構你所撰寫的project。makefile 會將程式分成好幾個模組，根據裡面的目標 (target)、規則 (rule) 和檔案的修改時間進行判斷哪些需要重新編譯，可以省去大量重複編譯的時間，這在大型程式中尤為有用。

而 catkin 這個套件則在 make 的基礎上加入了空間上的整合，讓你整個專案的開發有個統一的格式。

## 使用

catkin 大致上把一個工作區劃分為以下三個區塊
* src
用來存放 source code 以及各個 project 的地方，src 中的存放單位為 package
* build
用來放程式碼在編譯過程中的中間產物
* devel
編譯完的執行檔跟一些環境變數設定檔都會放置在這

![](https://i.imgur.com/sRYWvBL.png)

後兩個路徑由catkin系統自動生成、管理，我們日常的開發一般不會去涉及，而主要用到的是src資料夾，我們寫的ROS程式、網上下載的ROS原始碼包都存放在這裡。

在編譯時，catkin編譯系統會遞迴的查詢和編譯src/下的每一個原始碼包。因此你也可以把幾個原始碼包放到同一個資料夾下，如下圖所示：

![](https://i.imgur.com/A8HFSr5.png)

### package結構

      ├── CMakeLists.txt    #package的編譯規則(必須)
      ├── package.xml       #package的描述資訊(必須)
      ├── src/              #原始碼檔案
      ├── include/          #C++標頭檔案
      ├── scripts/          #可執行指令碼
      ├── msg/              #自定義訊息
      ├── srv/              #自定義服務
      ├── models/           #3D模型檔案
      ├── urdf/             #urdf檔案
      ├── launch/           #launch檔案

### package的建立

```shell=
catkin_create_pkg test_pkg roscpp rospy std_msgs
```
建立一個 package 需要在 catkin_ws/src 下,用到catkin_create_pkg命令，用法是：catkin_create_pkg package depends 其中package是包名，depends是依賴的包名，可以依賴多個軟體包。

例如，新建一個 package 叫做 test_pkg ,依賴 roscpp、rospy、std_msgs(常用依賴)。
新建完後就可在 src 中撰寫你的程式碼嘍。

### 編譯package

回到catkin workspace(catkin_ws)這層後輸入
```shell=
catkin_make
```
他就會自動幫你編譯所有package
![](https://i.imgur.com/ftsukdo.png)

編譯完後記得執行以下指令加入環境變數，不然你在Terminal上找不到你要執行的code喔
```shell=
source ~/catkin_ws/devel/setup.bash
```
# roscpp

ROS中的CPP檔是放置在package中的src！！！

### package結構

      ├── CMakeLists.txt    #package的編譯規則(必須)
      ├── package.xml       #package的描述資訊(必須)
      ├── src/              #原始碼檔案
      ├── include/          #C++標頭檔案
      ├── scripts/          #可執行指令碼
      ├── msg/              #自定義訊息
      ├── srv/              #自定義服務
      ├── models/           #3D模型檔案
      ├── urdf/             #urdf檔案
      ├── launch/           #launch檔案


## node simple sample

```shell=
cd ~/catkin_ws/src/<your_pkg>/src # 到你的project中的src中，src是用來存放source code的地方
gedit file_name.cpp # 新增一個cpp檔，並編輯。就是開始打code啦
```
```c=
#include <ros/ros.h>                             // 引用 ros.h 檔

int main(int argc, char** argv){
    ros::init(argc, argv, "hello_cpp_node");     // 初始化 hello_cpp_node
    ros::NodeHandle handler;                     // node 的 handler
    ROS_INFO("Hello World!");                    // 印出 Hello World
}
```
cpp 檔不像 python 檔一樣可以直接被執行，需要經過編譯以後才能轉成執行檔，因此我們需要修改 beginner_tutorial 內的 CMakeLists.txt ，為其設定好連結的函式庫。
由於他的CMakeLists.txt太長了，在此擷取片段做為參考:
```shell=
cd ~/catkin_ws/src/<your_pkg> #到你的project中
gedit CMakeLists.txt # 修改當中的CMakeLists.txt , 這是編譯的設定檔
```

```cmake=
//...上略
## Declare a C++ executable
## ...
## ...
## ...

add_executable(file_name src/file_name.cpp)
target_link_libraries(file_name ${catkin_LIBRARIES})

## Rename C++ executable without prefix
//...下略
```

修改完CMakeLists.txt後，接著須回到工作區的根目錄，也就是/catkin_ws中再執行一次catkin_make，他就會自己幫我們編譯好file_name.cpp的執行檔(file_name)囉!

接下來修改file_name.cpp，一樣新增一個迴圈，讓他在程式執行期間每秒印出一個hello world出來，程式碼如下:
```c=
#include <ros/ros.h>                             // 引用 ros.h 檔

int main(int argc, char** argv){
    ros::init(argc, argv, "hello_cpp_node");     // 初始化hello_cpp_node
    ros::NodeHandle handler;                     // node 的 handler
    while (ros::ok()){                           // 在 ros 順利執行時
        ROS_INFO("Hello World!");                // 印出 Hello World
        ros::Duration(1).sleep();                // 間隔 1 秒
    }
}
```
修改完file_name.cpp後，因為CMakeLists.txt已經改好了，只要再回去執行一次catkin_make，就可以重新編譯出一個新的file_name囉!

### [教學傳送門](https://ithelp.ithome.com.tw/articles/10204122)

## [Publisher](http://wiki.ros.org/roscpp/Overview/Publishers%20and%20Subscribers) simple sample

```c=
 #include "ros/ros.h"
 #include "std_msgs/String.h"
 #include <sstream>
  
 int main(int argc, char **argv)
 {
   ros::init(argc, argv, "talker");
   ros::NodeHandle n;
   ros::Publisher chatter_pub = n.advertise<std_msgs::String>("chatter", 1000); 
   ros::Rate loop_rate(10);

   int count = 0;
   while (ros::ok())
   {
     std_msgs::String msg;
     std::stringstream ss;
     ss << "hello world " << count;
     msg.data = ss.str();
 
     ROS_INFO("%s", msg.data.c_str());
     chatter_pub.publish(msg);
     ros::spinOnce(); 
     loop_rate.sleep();
     ++count;
   }
   return 0;
 }
```
### [教學傳送門](https://ithelp.ithome.com.tw/articles/10205657)

## [Subscriber](http://wiki.ros.org/roscpp/Overview/Publishers%20and%20Subscribers) simple sample

```c=
  #include "ros/ros.h"
  #include "std_msgs/String.h"

  void chatterCallback(const std_msgs::String::ConstPtr& msg)
  {
    ROS_INFO("I heard: [%s]", msg->data.c_str());
  }

  int main(int argc, char **argv)
  {
    ros::init(argc, argv, "listener");
    ros::NodeHandle n;
    ros::Subscriber sub = n.subscribe("chatter", 1000, chatterCallback);
    ros::spin();
    return 0;
  }
```
### [教學傳送門](https://ithelp.ithome.com.tw/articles/10205877)


# rospy

ROS中的Python檔是放置在package中的scripts！！！

### package結構

      ├── CMakeLists.txt    #package的編譯規則(必須)
      ├── package.xml       #package的描述資訊(必須)
      ├── src/              #原始碼檔案
      ├── include/          #C++標頭檔案
      ├── scripts/          #可執行指令碼
      ├── msg/              #自定義訊息
      ├── srv/              #自定義服務
      ├── models/           #3D模型檔案
      ├── urdf/             #urdf檔案
      ├── launch/           #launch檔案

## node simple sample

```python=
#!/usr/bin/env python
import rospy                             # import rospy 模組

rospy.init_node('hello_python_node')     # 初始化 hello_python_node

while not rospy.is_shutdown():           # 在 rospy 還沒結束前，執行下列指令:
    rospy.loginfo('Hello World')         # 印出 Hello World
    rospy.sleep(1)                       # 間隔 1 秒
```
編輯完code後幫code加權限
```shell=
chmod +x file_name.py
```
### [教學傳送門](https://ithelp.ithome.com.tw/articles/10203798)

## [Publisher](http://wiki.ros.org/rospy/Overview/Publishers%20and%20Subscribers) simple sample

```python=
 #!/usr/bin/env python
 # license removed for brevity
 import rospy
 from std_msgs.msg import String
 
 def talker():
     pub = rospy.Publisher('chatter', String, queue_size=10)
     rospy.init_node('talker', anonymous=True)
     rate = rospy.Rate(10) # 10hz
     while not rospy.is_shutdown():
         hello_str = "hello world %s" % rospy.get_time()
         rospy.loginfo(hello_str)
         pub.publish(hello_str)
         rate.sleep()
 
 if __name__ == '__main__':
     try:
         talker()
     except rospy.ROSInterruptException:
         pass
```
### [教學傳送門](https://ithelp.ithome.com.tw/articles/10205008)

## [Subscriber](http://wiki.ros.org/rospy/Overview/Publishers%20and%20Subscribers) simple sample

```python=
 #!/usr/bin/env python
 import rospy
 from std_msgs.msg import String
 
 def callback(data):
     rospy.loginfo(rospy.get_caller_id() + "I heard %s", data.data)
 
 def listener():
     rospy.init_node('listener', anonymous=True)
     rospy.Subscriber("chatter", String, callback)
     # spin() simply keeps python from exiting until this node is stopped
     rospy.spin()
 
 if __name__ == '__main__':
     listener()
```
### [教學傳送門](https://ithelp.ithome.com.tw/articles/10205362)

# Robot source code on github

## minibot sample code
https://github.com/kuoshih/hypharos_minibot

## turtlebot sample code
https://github.com/MathRoboticsLab/turtlebot3_sample

## Python for TB3 & minibot:
https://github.com/MathRoboticsLab/hypharos_minibot_turtlebot_python_sample



# 參考資料

**<a href="https://www.youtube.com/playlist?list=PL6S9AqLQkFprxJW18z1Nu9P2bnWCK4KmC" class="redlink">1. jserv ROS 教學</a>**

**<a href="http://wiki.ros.org/ROS/Introduction" class="redlink">2. ROS Introduction</a>**

**<a href="https://ai.stanford.edu/~mquigley/papers/icra2009-ros.pdf" class="redlink">3. ROS: an open-source Robot Operating System</a>**

**<a href="https://en.wikipedia.org/wiki/Peer-to-peer" class="redlink">4. Peer-to-peer wiki</a>**

**<a href="http://wiki.ros.org/" class="redlink">5. ROS WIKI</a>**

**<a href="https://www.itread01.com/content/1545152767.html" class="redlink">6. catkin tools</a>**

**<a href="https://ithelp.ithome.com.tw/users/20112348/ironman/1965" class="redlink">7. ROS自學筆記</a>**

**<a href="https://www.facebook.com/profile.php?id=100003209663210" class="redlink">8. 這人台大</a>**
