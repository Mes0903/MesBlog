---
title: GSM & UMTS & IGP
date: 2024/04/16
mathjax: true
description: GSM 與 UMTS 的筆記，順便介紹了一下 IGP
tags: computer-network
categories:
- computer-network
---

# GSM

## 前言

UMTS 是所謂的 3G 行動網路，它的前身為 GSM 與 GPRS，GSM 為 2G 行動網路，而 GPRS 為 2.5G 行動網路； GSM/GPRS 奠定了現今行動網路的架構基礎，後日 3G、4G 及 5G 的架構中我們都能發現其與 GSM/GPRS 的架構有很多相似之處，因此這裡就先將 GSM 的架構淺談一下

因為名詞實在是很多，所以太細節的東西，像是節點之間的介面用的是什麼訊號，這裡就先不談了，有篇文章講得很好，有興趣的可以看看：

- [WCDMA/UMTS 第三代無線通訊系統 Core Network 架構介紹﹝1﹞](https://loda.hala01.com/2017/05/wcdmaumts-core-network-1.html)
- [WCDMA/UMTS 第三代無線通訊系統 核心網路 架構介紹﹝2﹞](https://loda.hala01.com/2017/05/wcdmaumts-2.html)
- [WCDMA/UMTS 第三代無線通訊系統 Core Network 架構介紹﹝3﹞](https://loda.hala01.com/2017/05/wcdmaumts-core-network-3.html)

要再更細的話可能就要去看 spec 了，可以直接 google 搜，你會找到放在 esti 這個網站內的 pdf 檔，通常 3GPP 的 spec 應該都可以在這裡找到

行動網路與一般網路最大的不同點就是用戶會移動，因此業者會需要追蹤用戶的位置，當用戶移到別的業者地管轄範圍內時，仍然要讓使用者能通過其他業者的網路上網，這樣的動作我們稱其為漫遊 (Roaming)

而 GSM 是行動網路的協定，規定了手機要通話與上網的標準，說是上網，但當時的用處主要是傳簡訊和用手機打電話之類的，要到 GPRS 出來才真的有上網的感覺，開始可以下載一些鈴聲、小遊戲之類的

GSM 主要分為兩個部分，一個是 NSS (Network and Switching Subsystem)，另一個是 BSS (Base Station Subsystem)。 NSS 主要負責網路的控制，在 UMTS 中對應到核心網路(Core Network)，而 BSS 則是負責無線訊號的傳輸，在 UMTS 中對應到 RAN (Radio Access Network)

## BSS

在行動網路中，我們會將地圖以蜂窩狀來劃分為區域，因此行動網路又稱為蜂窩式網路。 每個蜂巢都有一個基地台系統，在 GSM 架構中我們將這個系統稱為 BSS (Base Station Subsystem)，而 BSS 又以 BTS (Base Transceiver Station) 和 BSC (Base Station Controller) 兩個部分組成

### BTS

基地台的內部通常會有 Transceiver 負責進行訊號的收發，除此之外還會需要諸如功率放大器、雙工器、合錄器和天線等設備，這些設備在 GSM 中統稱為 BTS (Base Transceiver Station)，BTS 是基地台系統的核心部分，負責將手機的訊號轉換為無線訊號，並將無線訊號轉換為手機的訊號

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/BTS.png?raw=true" width = "25%">

(典型的 BTS)  
(img src: [wiki](https://zh.wikipedia.org/zh-tw/%E5%9F%BA%E5%9C%B0%E6%94%B6%E5%8F%91%E6%9C%BA%E7%AB%99))

</center>

### BSC

由於 BTS 這樣的設備眾多，我們直接將它的訊號接到數據中心的話難免會有些雜亂，因此我們還需要一個控制器來控制基地台，相當於將 BTS 進行分組，這個控制器稱為 BSC (Base Station Controller)

因為是分組的概念，理所當然地一個 BSC 可以控制多個 BTS，是基地台的控制中心，負責處理無線電頻道的分配，接收來自行動電話的測量，並控制從 BTS 到 BTS 的切換等等的功能

> BSS = BTS + BSC

## NSS

### MSC

然而只有 BSS 是不夠的，我們肯定還會需要路由器和交換機之類的設備，不然上不了網，因此就需要一個地方來解析 BSS 傳來的訊息，在 GSM 架構下稱這個地方為 MSC (Mobile Switching Center)，可以說是 GSM 架構的心臟

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/MSC-server.png?raw=true" width = "50%">

(Lucent 於 2001~2006 部屬在 Ljubljana 的 MSC 服務器)  
(img src: [wiki](https://en.wikipedia.org/wiki/Mobile_switching_centre_server#/media/File:Lucent_5ESS_GSM_Mobile_Switching_Centre.jpg))

</center>

在 GSM 架構中，MSC 負責非常多的事項，像是無線頻寬資源的管理(稱為 RRM，Radio Resource Management)，處理語音資料格式的轉換，用戶呼叫的控制，用互更換蜂巢時的控制，用戶的身份認證，用戶的資料管理等等，全都是由 MSC 處理的

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/MSC-black.png?raw=true" width = "65%">

(MSC 與 BSS 關係示意圖)

</center>

而負責擔任 Gateway 的 MSC 被稱為 GMSC，負責處理來自其他 MSC 的資料，並且將資料轉發到其他的 MSC 或是大眾網路(PSTN) 中

### HLR & VLR

由於 MSC 還需要處理手機的用戶的資料，如用戶的方案、申請的位置等等，因此會需要有一個資料庫來存放這些資料，這個資料庫在階級上還有分大的和小的，分別為 HLR (Home Location Register) 與 VLR (Visitor Location Register)，都是拿來存放本地用戶的資料的

HLR 是中心資料庫，假設我們的 sim 卡是在台灣辦的，那我們辦卡時候用的所有資料，像是姓名、地址、電話號碼等等，就都會被存放在台灣的 HLR 中

而每個 MSC 中都還會有一個 VLR，VLR 用來存放當前 MSC 管轄範圍內的用戶資料，並且會實時更新資料到用戶對應的 HLR，假設我平常都在台北，那台北的 VLR 就會有我的訊息，台灣的 HLR 也會有，這時候我要用網路，台北的 MSC 就會去它自己的 VLR 內查詢我的資料

當我今天去了日本，我的手機網路就會跟著連到日本的 MSC，此時它一看見我的 IMSI 碼，就會發現我是台灣來的，因此就會到台灣的 HLR 中查詢我的資料，並且向台灣的 HLR 登記我現在在日本，好讓別人可以找到我； 當然，也要把我的資料複製到日本的 VLR 中，這樣我就可以在日本使用網路了

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/HLR-black.png?raw=true" width = "55%">

(HLR 與 VLR 示意圖)

</center>

## PSTN

雖然這樣上網是解決了，但是手機還需要能夠打電話，因此在 GSM 中，我們會將 MSR 與 PSTN (Public Switched Telephone Network) 連接起來，PSTN 是電話專用的電路交換網路，這樣就可以讓手機打電話了

所以假設手機 A 要傳簡訊，或是要打電話給國內的手機 B，而且業者不同(有不同 MSC)，那走的路線會是：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/GSM-net-black.png?raw=true" width = "55%">

</center>

而如果是要打電話給一般的家用電話，那走的路線會是：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/main/source/_posts/computer_network/GSM_UMTS_IGP/GSM-phone-black.png?raw=true" width = "40%">

</center>

國外就自己變通啦，一樣的道理，這裡就不講了

# GPRS

## 前言

GPRS 是 GSM 的延伸，是 2.5G 行動網路，其在 GSM 的基礎上延伸出了一個可以處理封包的架構，主要是在核心網路的部分新增了 SGSN (Serving GPRS Support Node) 和 GGSN (Gateway GPRS Support Node) 這兩個節點，好讓網路豐寶可以透過 GPRS 上網

因此原先的 MSC 就專注在處理語音通話與簡訊方面，而 SGSN 和 GGSN 就專注在處理網路上的封包，架構圖如下：



# UMTS

# IGP

後面主要是在介紹 IGP (Interior Gateway Protocol) 會先介紹一些背景知識，再來講解兩者的差異與相關的協定。

每個協定的說明會給一個例子，但要注意例子中的封包內容我有做過簡化，只是幫助理解用的，實際的封包內容還要去查協定的規範。

# Background

## Autonomous System (AS)

自治系統（Autonomous System，AS）是互聯網中的一個獨立的路由區域，通常由一個或多個路由器和連接到這些路由器的網絡組成。AS 通常由一個組織管理，例如一家企業、一個網絡服務提供商或一個大學。 在公共互聯網上，每個AS都有一個唯一的識別號稱為AS號（ASN），用於區分不同的AS。

AS 被劃分為兩種類型：內部自治系統（Internal AS）和外部自治系統（External AS），分別用於內部路由和外部路由。

## IGP & EGP

- IGP (Interior Gateway Protocol)  
  IGP 是內部網絡路由協定，用於在單一自治系統（AS）內部交換路由信息。IGP 通常用於在單一組織內部的路由選擇，例如在企業內部網絡中。IGP 通常有較短的路由更新時間和較小的路由表，因為它們只需要處理單一 AS 內部的路由。

- EGP (Exterior Gateway Protocol) 
  EGP 是用於不同自治系統之間交換路由信息的協定。EGP 通常用於在不同組織之間的路由選擇，例如在不同網絡服務提供商之間。EGP 通常有較長的路由更新時間和較大的路由表，因為它們需要處理不同 AS 之間的路由。

## Distance Vector(DV) & Link State(LS)

路由協定可以分為兩大類：Distance Vector 和 Link State：

- 距離向量（DV）算法  
  路由器僅與直接相鄰的路由器交換信息，並使用如Bellman-Ford算法來計算到達每個目的地的最短路徑。DV 算法的特點是簡單和容易實現，但它容易受到路由迴路和「計數到無窮大」的問題影響。

- 鏈路狀態（LS）算法  
  每台路由器學習整個網絡的拓撲結構，並獨立計算到達網絡中每個節點的最短路徑，通常使用 Dijkstra 算法。LS 算法能提供更快的收斂和更好的路由迴路預防，但它需要更多的CPU和記憶體資源。

## Classful & Classless

在網絡早期，為了簡化 IP 地址的分配和路由選擇，引入了類別化網絡（Classful Networking）概念。 這種方法將 IP 地址空間劃分為五類（A、B、C、D 和 E），每類有固定的網絡和主機數量。A 類地址支持大量主機（16,777,214個），而 C 類地址則適用於少量主機（254個）。

但隨著時間推移，Classful Networking 的限制逐漸變得明顯，尤其是在地址浪費和靈活性不足方面。 例如，一個只需要 300 個IP地址的組織可能不得不分配一個 B 類地址，從而浪費了大量未使用的地址。

為了解決這些問題，1993 年引入了 Classless Inter-Domain Routing（CIDR）概念。CIDR 使用可變長度的子網掩碼（Variable Length Subnet Masking，VLSM）來劃分IP地址空間，這允許更加靈活和高效的IP地址分配，使得 IP 地址的分配更加靈活。

CIDR 通過表示法「IP地址/前綴長度」來指示網絡部分和主機部分的分界，如 192.168.0.0/24 表示前 24 位是網絡地址，後 8 位是主機地址。這種方式使得可以更細粒度地分配IP地址，滿足不同組織的具體需求，例如一個組織可以只分配一個 /24 的地址空間，而不需要分配整個 C 類地址。

而在路由協定中，Classful 和 Classless 的區別在於是否傳遞子網掩碼信息。Classful Routing 只傳遞 IP 地址，而 Classless Routing 則傳遞 IP 地址和子網掩碼。

一般來說，Classless Routing 更加靈活和高效，因為它可以更好地支持 VLSM 和 CIDR，並減少地址浪費，因此現在通常都會傾向使用 Classless 的協定。

## Hop Count & Metric

在路由協定中，路由器選擇路由的標準通常是基於「距離」或「度量」。距離是一個抽象的概念，通常用來表示到達目的地的成本，例如跳數、延遲、帶寬等。度量則是具體的數值，用來表示路由的成本。

在距離向量算法中，常用的度量是「跳數」（Hop Count），即到達目的地所需的路由器數量。在 Link State 算法中，常用的度量是「成本」（Cost），通常是基於帶寬、延遲等因素來計算。

在後面的文章中，我們會看到不同的路由協定使用不同的度量標準，例如 RIP 使用跳數作為度量，OSPF 使用帶寬和延遲作為度量。

# IGP

## RIP (Routing Information Protocol)

最早的 RIP 版本（即RIPv1）是在 1988 年通過 RFC 1058 標準化的，但它的概念和實現可以追溯到更早的時候，大約是在互聯網創始時期的 1980 年代初期。 RIP 的設計是為了小型網絡，並且它很快就因為簡單和易於實現而變得流行

### RIPv1

- 歷史簡介  
  RIPv1，全稱為路由信息協議第一版，於 1988 年定義於 [RFC 1058](https://datatracker.ietf.org/doc/html/rfc2453)。作為一種內部網關協議（IGP），它主要用於小型到中型網絡中。RIPv1 的設計目的是為了簡單和自動的路由選擇。

- 演算法的詳細內容  
  RIPv1 使用距離向量算法，其中每條路由的「距離」由到達目的地所需的跳數（hop count）來量化，最多 15 跳，超過 15 跳的路由被認為是不可達的。RIPv1 定期（每30秒）通過其接口向直接相鄰的路由器發送整個路由表，使用UDP協議。

- 分類  
  - DV
  - Classful

- 優缺點  
  - 優點：簡單易於實施，適用於小型網絡。
  - 缺點：路由信息僅基於跳數，不考慮網絡帶寬或延遲；最大只支持 15 跳，限制了網絡大小；不支持CIDR，導致IP地址利用不充分。

- 使用場景  
  RIPv1 適合於小型、設計簡單的網絡，其中網絡設備較少，網絡拓撲變化不大。

- 例子  
  假設有三個路由器 R1、R2、R3，它們在一個使用 RIPv1 的網絡中：

  - R1 連接到 10.0.0.0/24 網段。
  - R2 連接到 10.0.1.0/24 網段。
  - R3 連接到 10.0.2.0/24 網段。

  其中 R1 和 R2 直接相連，R2 和 R3 直接相連。
  
  在 RIPv1 中，R1 會定期（通常每30秒）向其鄰居（此例中為 R2）發送整個路由表。R1 的更新封包可能包括以下資訊：

  - 目的網絡：10.0.0.0/24，跳數：0（直接連接）
  - 目的網絡：10.0.1.0/24，跳數：1（通過R2）
  - 目的網絡：10.0.2.0/24，跳數：2（通過R2和R3）

  RIPv1 的封包不包含子網掩碼資訊，因此它不支持無類別域間路由（CIDR）。
  
  但 RIP 有路由迴路與計數到達無窮大的問題，假設有四個路由器 R1、R2、R3 和 R4，構成一個網絡拓撲如下：

  - R1 連接到網段 A。
  - R2 連接到網段 B。
  - R3 連接到網段 C。
  - R4 連接到網段 D。

  R1 與 R2 直接相連，R2 與 R3 直接相連，R3 與 R4 直接相連。

  在正常運作時，假設 R1 要發送數據到網段 D，最短路徑將是 R1 -> R2 -> R3 -> R4。

  - 路由迴路  
    現在假設 R2 與 R3 之間的鏈路失效，但 R2 和 R3 尚未意識到這個變化。這時，R1 嘗試通過 R2 到達網段 D，而 R2 可能因為還沒有更新其路由表，而試圖通過 R3 來達到網段 D。同時，R3 可能嘗試通過 R2 來達到網段 D（因為它也還沒有意識到鏈路的失效）。此時封包就會在 R2 和 R3 之間形成迴路，無法到達目的地。

  - 計數到無窮大  
    當 R2 和 R3 最終意識到到達網段 D 的路徑不再可用時，它們開始通過增加跳數的方式來表示網段 D 的不可達性。在 RIPv1中，16 跳被認為是無窮大，表示網絡不可達。問題是，在所有路由器達成一致之前，這個信息需要時間在網絡中傳播，期間數據包可能仍在網絡中無效傳遞。

### RIPv2

- 歷史簡介  
  RIPv2（路由信息協議第二版）於 1998 年定義於 [RFC 2453](https://datatracker.ietf.org/doc/html/rfc1058)，是 RIPv1 的改進版本。 它在 RIPv1 的基礎上增加了對 CIDR（無類別域間路由）的支持、路由認證功能和多播更新，解決了 RIPv1 中的一些問題，如缺乏路由認證和無法有效利用IP地址空間。

- 演算法  
  RIPv2 仍然使用距離向量算法，以跳數作為路徑度量，最大跳數限制為 15。不同於 RIPv1 的是，RIPv2 在其路由更新消息中包括了子網掩碼，從而支持無類別路由。此外，RIPv2 使用多播地址 224.0.0.9 來發送更新，而不是像 RIPv1 那樣向整個網絡廣播，這減少了不必要的網絡流量。

- 分類  
  - DV
  - Classless

- 優缺點  
  - 優點：相比 RIPv1，RIPv2 支持更靈活的IP地址使用和更安全的路由更新。
  - 缺點：仍然使用跳數作為唯一的度量標準，不考慮網絡的其他性能指標如帶寬或延遲；路由更新頻繁，可能導致網絡資源的浪費。

- 使用場景  
  RIPv2 適用於小型至中型的網絡，特別是在需要支持更靈活的子網配置和簡單路由策略的環境中。

- 例子：  
  RIPv2 在 RIPv1 的基礎上增加了子網掩碼的支持。在同樣的網絡拓撲下，RIPv2 的更新封包將包括子網掩碼和可能的下一跳地址。R1 發送給 R2 的更新可能包含如下信息：

  - 網絡 A，子網掩碼 255.255.255.0，跳數 0。
  - 網絡 B，子網掩碼 255.255.255.0，跳數 0。
  - 網絡 C，子網掩碼 255.255.255.0，跳數 2。
  - 網絡 D，子網掩碼 255.255.255.0，跳數 3。
  
  RIPv2的更新是通過多播地址 224.0.0.9 發送的，這減少了不必要的網絡流量。

## IGRP (Interior Gateway Routing Protocol)

- 歷史簡介  
  內部網關路由協議（IGRP）是由思科系統在 1980 年代開發的一種距離向量路由協議。它被設計來克服 RIPv1 協議在大型網絡中的不足，如路由迴路和網絡流量問題。

- 演算法的詳細內容  
  IGRP 使用一種復合度量來計算路由，這個度量考慮了多個因素，包括帶寬、延遲、負載和可靠性。這使得 IGRP 能夠選擇更優的路由，並適應不同網絡條件。IGRP 也採用了一些技術來避免路由迴路問題，例如路由毒化和定時更新。

- 分類  
  - DV
  - Classful

- 優缺點  
  - 優點：比 RIP 更適合於大型網絡，可以考慮到多個路徑度量，從而提供更有效的路由選擇。
  - 缺點：作為一種 Classful 協議，它的使用受限於思科設備。配置和管理相對較複雜。

- 使用場景  
  - IGRP 適合於中型至大型網絡，特別是在這些網絡中主要使用思科設備的情況下。

- 例子：  
  假設有一個網絡包括三台路由器 R1、R2 和 R3。 R1 連接到網段 10.0.0.0/24，R2 連接到網段 10.0.1.0/24，而 R3 連接到網段 10.0.2.0/24，R1 與 R2 之間、R2 與 R3 之間有直接連接。

  當 R1 向 R2 通告其路由資訊時，它會發送一個 IGRP 更新封包。這個更新封包包含如下資訊：

  - 版本號：IGRP 的版本，例如 1。
  - 自治系統號：假設為 100。
  - 網絡資訊：關於網絡 10.0.0.0 的資訊，子網掩碼為 255.255.255.0，度量值基於帶寬和延遲，例如度量值為 12000。
  - 更新間隔：IGRP使用的更新間隔，通常為 90 秒。

  當 R2 收到來自 R1 的這個更新時，它會根據 IGRP 的複合度量標準（包括帶寬和延遲）來計算到達 10.0.0.0/24 網段的最佳路徑。 隨後，R2 會更新自己的路由表，以反映通過 R1 到達 10.0.0.0/24 網段的最佳路徑。

  在這個過程中，如果 R3 也屬於同一自治系統，R2 可能還會將學到的路由資訊通告給 R3。這樣，整個 IGRP 自治系統中的所有路由器都能獲取到網絡中所有網段的路由資訊，並計算到達這些網段的最佳路徑。

## EIGRP (Enhanced Interior Gateway Routing Protocol)

- 歷史簡介  
  - 增強內部網關路由協議（Enhanced Interior Gateway Routing Protocol，EIGRP）於1992年由思科系統開發，作為IGRP的後續版本。EIGRP結合了距離向量協議和鏈路狀態協議的特點，提供了一種快速且可靠的路由選擇方法。

- 演算法的詳細內容  
  EIGRP 使用稱為 DUAL（Diffusing Update Algorithm）的算法來計算路由。 DUAL 算法確保了路由計算的一致性和迴路自由。EIGRP 不僅考慮到路徑的帶寬和延遲，還可以根據負載和可靠性來選擇路徑。EIGRP 傳播增量更新，這意味著只有路由變化時才發送更新，從而減少了帶寬的使用。

- 分類  
  - Hybrid（DV + LS）
  - Classless

- 優缺點  
  - 優點：EIGRP能夠快速收斂，支持多種網絡協議（包括IP、IPX和AppleTalk），並允許跨協議路由。它還支持負載平衡和多路徑。
  - 缺點：作為一種專有協議，EIGRP最初只在思科設備上可用。雖然思科已經發布了EIGRP的核心部分作為開放標準，但它的普及度仍受到限制。

- 使用場景  
  - EIGRP 適用於從小型到大型的各種網絡環境，尤其是當網絡中存在多種思科設備時，EIGRP 可以提供高效且穩定的路由解決方案。

- 例子：  
  假設路由器 R1 有一個直接連接到 10.0.0.0/24 的接口。在 EIGRP 中，R1 會發送一個 EIGRP 更新封包，其中包含如下信息：

  - 封包類型：更新（Update）
  - 自治系統號：100（假設 R1 屬於 AS 100）
  - 路由器ID：R1 的 ID，比如 1.1.1.1
  - 網絡：10.0.0.0
  - 子網掩碼：255.255.255.0
  - 下一跳地址：0.0.0.0（表示直接連接）
  - 度量：
  - 帶寬：100 Mbps（假設接口帶寬為 100 Mbps）
  - 延遲：10 微秒（假設延遲）
  - 可靠性：255（最高可靠性）
  - 負載：1（最低負載）
  - MTU：1500 字節
  
  當 R2 收到來自 R1 的這個更新時，它會根據接收到的度量值計算到達 10.0.0.0/24 的最佳路徑並更新自己的路由表。

## OSPF (Open Shortest Path First)

- 歷史簡介  
  開放最短路徑優先（Open Shortest Path First，OSPF）是一種鏈路狀態路由協議，於 1989 年推出。OSPF 被設計來替代 RIP協議，適用於更大型和更複雜的網絡環境。

- 演算法的詳細內容  
  OSPF 使用 Dijkstra 算法來建立和計算最短路徑樹。每台路由器都構建一個包含網絡所有鏈路狀態的數據庫，然後使用這個數據庫來計算到達各個目的地的最佳路徑。OSPF 能夠支持 CIDR 和 VLSM，提供了對不同大小子網的靈活支持。

- 分類  
  - LS
  - Classless

- 優缺點  
  - 優點：OSPF 提供快速的收斂速度，支持複雜的拓撲結構，並且能夠有效地應對網絡變化。它支持分區（Area）概念，有助於網絡的規劃和管理。
  - 缺點：配置和管理相對較為複雜，對網絡設備的資源（如記憶體和處理能力）要求較高。

- 使用場景  
  OSPF適合於中到大型網絡，特別是需要高度可控和靈活性的環境，如教育機構、大型企業和政府機構的網絡。

- 例子：
  在 OSPF 中，路由器通過發送鏈路狀態廣告（LSA）來交換信息。如果 R1 要宣告它到 10.0.0.0/24 的連接，它的 LSA 可能包含以下信息：

  - LSA 類型：Router LSA（路由器 LSA）
  - 路由器 ID：R1 的 ID，比如 1.1.1.1
  - 網絡：10.0.0.0/24
  - 子網掩碼：255.255.255.0
  - 度量：10（假設到達該網絡的成本為 10）
  - 鏈路類型：點到點鏈路
  - 鏈路 ID：與 10.0.0.0/24 網絡相連的 R1 的接口地址

  當其他路由器收到這個 LSA 時，它們將更新自己的鏈路狀態數據庫（LSDB）並使用 Dijkstra 算法計算到達所有已知網絡的最短路徑。

## IS-IS (Intermediate System to Intermediate System)

- 歷史簡介  
  中間系統到中間系統（Intermediate System to Intermediate System，IS-IS）協議最初是為 OSI（開放系統互聯）參考模型而開發，後來被擴展以支持 IP 網絡。IS-IS 於 1980 年代後期被引入。

- 演算法的詳細內容  
  IS-IS 是一種鏈路狀態協議，與 OSPF 相似。它使用 Dijkstra 算法來計算最短路徑。IS-IS 的獨特之處在於它分為兩個層次：級別 1 用於同一區域內的路由計算，而級別 2 用於不同區域之間的路由計算。

- 分類
  - LS
  - Classless

優缺點
  - 優點：IS-IS 能夠高效地處理大型和複雜的網絡拓撲，並且對於網絡變化具有良好的適應性。它適合於大型企業和互聯網服務提供商。
  - 缺點：與 OSPF 相比，IS-IS 的普及率較低，部分原因是它相對較難配置和理解。

- 使用場景
  - IS-IS 適合於大型的網絡環境，尤其是在需要有效管理大量路由信息和支持高速數據傳輸的場合。

- 例子：

  假設我們有三個路由器 R1、R2 和 R3，在 IS-IS 協議下運作。R1 和 R2 處於同一區域（Area 1），而 R3 位於另一區域（Area 2）。R1 和 R2 之間有直接連接，R2 和 R3 之間也有直接連接。R1 要宣告它到自己直連網段 10.0.0.0/24 的路由信息。

  在 IS-IS 中，R1 會生成一個鏈路狀態 PDU（協議數據單元），稱為 LSP（鏈路狀態廣告），其中可能包含以下信息：

  - PDU 類型：LSP
  - 路由器 ID：R1 的ID，如 1.1.1.1
  - 區域地址：Area 1
  - LSP 序列號：用於確保更新信息的新鮮度
  - 有效期：通常是一個預設時間，例如 1800 秒，以確保信息的及時更新
  - 鏈路條目：
  - 網絡：10.0.0.0/24
  - 度量：10（假設從 R1 到 10.0.0.0/24 的成本為 10）
  - 鏈路類型：點到點鏈路
  - R2 收到來自 R1 的 LSP 後，會將其信息添加到自己的鏈路狀態數據庫中，並進行路由計算。在 IS-IS 中，路由計算基於 Dijkstra 算法，路由器會計算到達網絡所有已知部分的最短路徑。

  如果 R2 同時與 R1（在Area 1）和 R3（在Area 2）有連接，R2 作為 Level-1-2 路由器，將在兩個區域間進行路由信息的傳遞。R2 會將從 R1 學到的關於 10.0.0.0/24 網絡的信息，以及自己的直連網絡信息，通過 Level-2 LSP 傳遞給 Area 2 中的 R3，從而實現區域間的路由。