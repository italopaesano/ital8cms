{ pkgs ? import <nixpkgs> {} }:

(pkgs.buildFHSUserEnv {
  name = "playwright-env";
  targetPkgs = pkgs: with pkgs; [
    nodejs_20

    # Playwright browser dependencies
    glib
    nss
    nspr
    atk
    at-spi2-atk
    cups
    dbus
    libdrm
    gtk3
    pango
    cairo
    xorg.libX11
    xorg.libXcomposite
    xorg.libXcursor
    xorg.libXdamage
    xorg.libXext
    xorg.libXfixes
    xorg.libXi
    xorg.libXrandr
    xorg.libXrender
    xorg.libXtst
    xorg.libxcb
    xorg.libxshmfence
    mesa
    expat
    alsa-lib
    pciutils
    libxkbcommon
    freetype
    fontconfig
    stdenv.cc.cc.lib
  ];
  runScript = "bash";
}).env
