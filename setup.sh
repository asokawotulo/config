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

echo "Installing Oh My Zsh..."
if ! [ -d "$HOME/.oh-my-zsh" ]; then
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
else
    echo "Oh My Zsh is already installed, skipping installation..."
fi

# Install Brew
echo "Installing Brew..."
if ! command -v brew &> /dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Brew is already installed, skipping installation..."
fi

# Symlink background image
echo "Symlinking background image..."
rm -f "$HOME/Pictures/background.png"
ln -sf "$CONFIG_DIR/background/background.png" "$HOME/Pictures/background.png"

# Symlink automator scripts
echo "Symlinking automator scripts..."
mkdir -p "$HOME/Library/Services"
ln -sf "$CONFIG_DIR/automator/Open in Code Editor.workflow" "$HOME/Library/Services/"

# Symlink git configuration files
echo "Symlinking git configuration files..."
backup_and_link "$CONFIG_DIR/git/gitconfig" "$HOME/.gitconfig"
backup_and_link "$CONFIG_DIR/git/gitignore" "$HOME/.gitignore"

# Symlink shell configuration files
echo "Symlinking shell configuration files..."
backup_and_link "$CONFIG_DIR/shell/zshrc" "$HOME/.zshrc"
backup_and_link "$CONFIG_DIR/shell/zprofile" "$HOME/.zprofile"

# Symlink starship configuration
echo "Symlinking starship configuration..."
mkdir -p "$HOME/.config"
backup_and_link "$CONFIG_DIR/shell/starship.toml" "$HOME/.config/starship.toml"

# Symlink ghostty configuration
echo "Symlinking ghostty configuration..."
mkdir -p "$HOME/.config/ghostty"
backup_and_link "$CONFIG_DIR/ghostty/config" "$HOME/.config/ghostty/config"

# Symlink opencode configuration
echo "Symlinking opencode configuration..."
mkdir -p "$HOME/.config/opencode"
backup_and_link "$CONFIG_DIR/opencode" "$HOME/.config/opencode"

# Symlink btca configuration
echo "Symlinking btca configuration..."
mkdir -p "$HOME/.config/btca"
backup_and_link "$CONFIG_DIR/btca" "$HOME/.config/btca"

# Symlink nix configuration directory
echo "Symlinking nix configuration directory..."
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
