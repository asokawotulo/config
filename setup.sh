#!/bin/bash

set -e

CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up development environment..."

# Create backup directory for existing configs
BACKUP_DIR="$CONFIG_DIR/backup"
mkdir -p "$BACKUP_DIR"

# Function to backup and symlink
backup_and_link() {
    local source="$1"
    local target="$2"
    local backup_name="$(basename "$target")"

    if [ -e "$target" ] || [ -L "$target" ]; then
        echo "Backing up existing $target to $BACKUP_DIR/$backup_name"
        cp -rf "$target" "$BACKUP_DIR/$backup_name" 2>/dev/null || true
        rm -rf "$target"
    fi

    echo "Linking $source -> $target"
    ln -sf "$source" "$target"
}

# Symlink git configuration files
backup_and_link "$CONFIG_DIR/git/gitconfig" "$HOME/.gitconfig"
backup_and_link "$CONFIG_DIR/git/gitignore" "$HOME/.gitignore"

# Symlink shell configuration files
backup_and_link "$CONFIG_DIR/zshrc" "$HOME/.zshrc"
backup_and_link "$CONFIG_DIR/zprofile" "$HOME/.zprofile"

# Symlink warp configuration
mkdir -p "$HOME/.warp/themes"
backup_and_link "$CONFIG_DIR/warp/monokai.yaml" "$HOME/.warp/themes/monokai.yaml"

# Symlink starship configuration
mkdir -p "$HOME/.config"
backup_and_link "$CONFIG_DIR/starship.toml" "$HOME/.config/starship.toml"

# Symlink nix configuration directory
backup_and_link "$CONFIG_DIR/nix" "$HOME/.config/nix"

# Install Nix using Determinate Systems installer
echo "Installing Nix using Determinate Systems installer..."
if ! command -v nix &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
    echo "Nix installation complete!"
    # Source nix for current session
    source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
else
    echo "Nix is already installed, skipping installation..."
fi

# Run nix-darwin switch
echo "Running nix-darwin switch..."
cd "$CONFIG_DIR/nix"
sudo nix run nix-darwin -- switch --flake .#setup

# Build karabiner configuration
echo "Building karabiner configuration..."
cd "$CONFIG_DIR/karabiner"
bun run build

echo "Development environment setup complete!"
echo "Backup of previous configs saved to: $BACKUP_DIR"
echo "Please restart your shell or run 'source ~/.zshrc' to apply changes."
