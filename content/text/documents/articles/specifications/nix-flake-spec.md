---
title: "Nix flake spec"
description: "How OS images are built with Nix flakes. Reproducible derivations; multi-language; Guix manifest shadow."
kind: spec
status: normative
version: "0.1"
---

# Nix flake spec

The OS uses Nix flakes (https://nixos.wiki/wiki/Flakes) for reproducible image building. Per [decisions/package-format-is-nix-flake.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/package-format-is-nix-flake.md).

## 1. Top-level flake structure

```nix
# flake.nix at repository root
{
  description = "The 561 group's OS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }: flake-utils.lib.eachDefaultSystem (system:
    let
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages = {
        default = self.packages.${system}.substrate-os;
        substrate-os = pkgs.callPackage ./nix/substrate-os.nix { };
        substrate-py = pkgs.callPackage ./nix/substrate-py.nix { };  # Python implementation
        substrate-rs = pkgs.callPackage ./nix/substrate-rs.nix { };  # Rust implementation
      };
      devShells.default = import ./nix/dev-shell.nix { inherit pkgs; };
    });
}
```

## 2. Image derivation

The OS image is a Nix derivation containing:

- The substrate runtime binary (Python wheel or Rust executable).
- The bundled-userland packages (v0.3+).
- Default closure rules, drivers, runbooks, init scripts.
- Configuration cells.
- A bootable wrapper (systemd unit file or equivalent).

## 3. Dual-language

Both Python and Rust implementations build via the same flake. Choose at build time:

```sh
nix build .#substrate-py    # Python implementation
nix build .#substrate-rs    # Rust implementation (when available)
nix build .#default         # Default (currently substrate-py at v0.1; substrate-rs at v0.7+)
```

## 4. Reproducibility

`nix build` produces a byte-identical image given identical inputs (flake.lock pinned). Image hash is the substrate's identity.

## 5. Guix manifest shadow

A parallel `guix.scm` exists alongside `flake.nix`:

```scheme
(use-modules (guix manifest) (guix download))
;; Equivalent to flake.nix, in Scheme.
```

Both produce equivalent images; the captain's long-term aspiration is Guix-with-Nix-inside.

## 6. Build pipeline

```
git pull → flake.lock → nix build → image hash → publish
```

Builds run inside the OS itself from v0.2+ (self-hosting per [decisions/self-hosting-by-v0.2.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/self-hosting-by-v0.2.md)).

## 7. Conformance

Nix flake passes:

1. `nix build .#default` produces a bootable image.
2. Image is reproducible: same inputs → same image hash.
3. Image boots in QEMU and reaches `ready` state.
