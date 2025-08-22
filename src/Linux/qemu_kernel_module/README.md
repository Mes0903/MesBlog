---
title: 利用 qemu 搭建學習 kernel module 的環境
date: 2025-08-22
tag: Linux
category: Linux
---

# 利用 qemu 搭建學習 kernel module 的環境

## 前言

起因是最近在閱讀 lkmpg，原本是使用 UML 來做練習，但由於 UML 缺了一些東西，例如它不會有 `read_cr0()` 這類依賴於硬體平台的函式，所以後來就決定還是用 qemu 來做練習，也因此本文會以 lkmpg 當中的例子來示範

基本上建環境的流程與之前[〈實作一個回傳物理位址的系統呼叫〉](../physical_address_syscall/README.md)的那篇差不多，但這篇一樣會把全部的步驟記錄下來，方便之後閱讀

整個練習的資料夾架構如下：

```shell
mes@mes:~/MesRepo/lkmpg-demo$ tree -L 1
.
├── busybox-1.36.1
├── busybox-1.36.1.tar.bz2
├── initramfs
├── initramfs.cpio.gz
├── linux-6.8
├── linux-6.8.tar.xz
└── lkmpg
```

## Build Linux Kernel

首先安裝一下依賴庫和 qemu：

```shell
sudo apt update
sudo apt install -y build-essential git bc bison flex libelf-dev libssl-dev \
                    qemu qemu-system-x86 linux-libc-dev
```

因為我不是直接從一個乾淨的環境開始建置的，所以不確定上面的指令會不會少裝什麼東西，但這類 minimal kernel + BusyBox + initramfs 的做法應該很多教學都有示例與命令可以參考，有缺的話應該 google 一下就能找到很多文章了<sup>[例1](https://ops.tips/notes/booting-linux-on-qemu/), [例2](https://cylab.be/blog/320/build-a-kernel-initramfs-and-busybox-to-create-your-own-micro-linux?utm_source=chatgpt.com)</sup>

接著下載 linux kernel 並編譯：

```shell
# in lkmpg-demo
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.8.tar.xz
tar -xvf linux-6.8.tar.xz
cd linux-6.8
make defconfig
./scripts/config --enable CONFIG_MODULES \
                 --enable CONFIG_MODULE_UNLOAD \
                 --enable CONFIG_BLK_DEV_INITRD \
                 --enable CONFIG_PROC_FS \
                 --enable CONFIG_SYSFS \
                 --enable CONFIG_DEVTMPFS \
                 --enable CONFIG_DEVTMPFS_MOUNT \
                 --enable CONFIG_SERIAL_8250 \
                 --enable CONFIG_SERIAL_8250_CONSOLE \
                 --enable CONFIG_TMPFS
make olddefconfig
make -j$(nproc)
```

這邊把一些會用到的 config 開起來了，但就如 lkmpg 內文說到的，當中的有些範例需要在特定的 linux 版本跑，另外還有些例子是以樹莓派／開發板為例的，那些也跑不起來。 因此你可能需要在跑某些例子時，去調整 kernel／qemu 的設定

## Build Root FS

這邊為了方便我就直接用 initramfs 了，你也可以另外掛磁碟出來

首先我們先把 kernel module 編好，這邊以 lkmpg 內的 code 的為例：

```shell
# in lkmpg-demo/
git clone https://github.com/sysprog21/lkmpg.git
cd lkmpg/examples
make -j"$(nproc)" KDIR=../../linux-6.8
```

再來要編 BusyBox，先設定 busybox：

```shell
# in lkmpg-demo/
curl -LO https://busybox.net/downloads/busybox-1.36.1.tar.bz2
tar xjf busybox-1.36.1.tar.bz2
cd busybox-1.36.1
make menuconfig
```

此時有兩個地方要改：

- 進去 `Networking Utilities`，接著取消勾選 `[*] tc`（變成 `[ ] tc`）
- 回到首頁，進去 `Settings`，把 `Build static binary (no shared libs)` 勾起來

接著存檔，然後編譯：

```shell
# in lkmpg-demo/busybox-1.36.1
make -j$(nproc)
make CONFIG_PREFIX="$PWD/_install" install
```

接著要做 initramfs，順便把 lkmpg 的範例包進去：

```shell
# in lkmpg-demo/
mkdir -p initramfs/{bin,sbin,etc,proc,sys,dev,root,usr/bin,usr/sbin}
cp -a busybox-1.36.1/_install/. initramfs/
mkdir -p initramfs/root/ko
cp -a lkmpg/examples/*.ko initramfs/root/ko/ 2>/dev/null || true
```

建立 `/init` 啟動腳本並打包成 `initramfs.cpio.gz`：

```shell
# in lkmpg-demo/
cat > initramfs/init <<'SH'
#!/bin/sh
mount -t proc     proc /proc
mount -t sysfs    sys  /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null
echo "[initramfs] $(uname -srmo)"
echo "[initramfs] .ko at /root/ko ; sources at /root/examples"
exec /bin/sh
SH
chmod +x initramfs/init
( cd initramfs && find . -mindepth 1 -print0 | cpio --null -ov --format=newc | gzip -9 ) > initramfs.cpio.gz
```

## 測試 kernel module

首先啟動 qemu：

```shell
qemu-system-x86_64 \
  -kernel linux-6.8/arch/x86/boot/bzImage \
  -initrd initramfs.cpio.gz \
  -nographic -append "console=ttyS0"
```

如果要退出 qemu，只要先按 ctrl+A，再按 x 就可以了。 再來可以確認一下 shell 有沒有正常運作：

```shell
/bin/busybox --help
```

然後載入個模組看看，以書中的 `hello-5.ko` 為例：

```shell
insmod /root/ko/hello-5.ko mystring="bebop" myintarray=-1
dmesg | tail -n 8
rmmod hello-5
insmod /root/ko/hello-5.ko mystring="supercalifragilisticexpialidocious" myintarray=-1,-1
dmesg | tail -n 8
rmmod hello-5
dmesg | tail -1
insmod /root/ko/hello-5.ko mylong=hello
```

這邊要注意一下 busybox 的 `dmesg` 沒有 `-t` 的選項，所以命令會長的不太一樣

輸出：

```shell
~ # insmod /root/ko/hello-5.ko mystring="bebop" myintarray=-1
[  118.182465] hello_5: loading out-of-tree module taints kernel.
[  118.191873] Hello, world 5
[  118.191873] =============
[  118.192532] myshort is a short integer: 1
[  118.192928] myint is an integer: 420
[  118.193299] mylong is a long integer: 9999
[  118.193618] mystring is a string: bebop
[  118.193892] myintarray[0] = -1
[  118.194173] myintarray[1] = 420
[  118.194533] got 1 arguments for myintarray.
[  118.196837] insmod (53) used greatest stack depth: 14040 bytes left
~ # dmesg | tail -n 8
[  118.192532] myshort is a short integer: 1
[  118.192928] myint is an integer: 420
[  118.193299] mylong is a long integer: 9999
[  118.193618] mystring is a string: bebop
[  118.193892] myintarray[0] = -1
[  118.194173] myintarray[1] = 420
[  118.194533] got 1 arguments for myintarray.
[  118.196837] insmod (53) used greatest stack depth: 14040 bytes left
~ # rmmod hello-5
[  132.266951] Goodbye, world 5
~ # dmesg | tail -1
[  132.266951] Goodbye, world 5
~ # insmod /root/ko/hello-5.ko mystring="supercalifragilisticexpialidocious" myintarray=-1,-1
[  194.062384] Hello, world 5
[  194.062384] =============
[  194.062896] myshort is a short integer: 1
[  194.063343] myint is an integer: 420
[  194.063636] mylong is a long integer: 9999
[  194.063970] mystring is a string: supercalifragilisticexpialidocious
[  194.064588] myintarray[0] = -1
[  194.064840] myintarray[1] = -1
[  194.065128] got 2 arguments for myintarray.
~ # dmesg | tail -n 8
[  194.062896] myshort is a short integer: 1
[  194.063343] myint is an integer: 420
[  194.063636] mylong is a long integer: 9999
[  194.063970] mystring is a string: supercalifragilisticexpialidocious
[  194.064588] myintarray[0] = -1
[  194.064840] myintarray[1] = -1
[  194.065128] got 2 arguments for myintarray.
[  236.008642] Goodbye, world 5
~ # rmmod hello-5
[  236.008642] Goodbye, world 5
~ # dmesg | tail -1
[  236.008642] Goodbye, world 5
```
