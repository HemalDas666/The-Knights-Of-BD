// ============================================
// THE KNIGHT'S OF BD - COMPLETE WEBSITE SCRIPT
// ============================================

// Server Configuration
const SERVER_CONFIG = {
    mainIP: 'theknightsofbd.mcsh.io',
    javaIP: 'theknightsofbd.mcsh.io:25565',
    bedrockIP: 'theknightsofbd.mcsh.io',
    bedrockPorts: ['19132', '11772'],
    discordLink: 'https://discord.gg/GU9426EpBM'
};

// DOM Elements
let loadingScreen, modal, backToTopBtn, copyIpBtn, discordBtn, closeModalBtns, floatingCopyBtn;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    initLoadingScreen();
    initModal();
    initBackToTop();
    initCopyButtons();
    initDiscordButton();
    initCloseModalButtons();
    initFloatingCopyButton();
    initGentleEffects();
    
    // Show welcome notification after load
    setTimeout(() => {
        showWelcomeNotification();
    }, 2000);
});

// ====================
// LOADING SCREEN
// ====================
function initLoadingScreen() {
    loadingScreen = document.getElementById('loadingScreen');
    
    if (loadingScreen) {
        setTimeout(() => {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 500);
        }, 2000);
    }
}

// ====================
// FLOATING COPY BUTTON (Top Left Corner)
// ====================
function initFloatingCopyButton() {
    floatingCopyBtn = document.getElementById('floatingCopyBtn');
    
    if (floatingCopyBtn) {
        floatingCopyBtn.addEventListener('click', async () => {
            await copyMainIP();
        });
    }
}

async function copyMainIP() {
    const ip = SERVER_CONFIG.mainIP;
    
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(ip);
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = ip;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
        
        // Show the copy notification
        showCopyNotification();
        
        // Vibrate on mobile
        if (navigator.vibrate) {
            navigator.vibrate(100);
        }
        
    } catch (err) {
        showNotification('Copy Failed', 'Please copy manually: ' + ip, 'error');
    }
}

// ====================
// WELCOME NOTIFICATION (Blue to Cyan)
// ====================
function showWelcomeNotification() {
    const container = document.getElementById('notificationContainer');
    
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification toast-welcome';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-crown"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">🎮 Welcome to The Knight's OF BD! 🎮</div>
            <div class="toast-message">Join our epic Minecraft adventure! ✨</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast-notification').remove()">
            <i class="fas fa-times"></i>
        </button>
        <div class="toast-progress">
            <div class="toast-progress-bar"></div>
        </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

// ====================
// COPY NOTIFICATION (Cyan to Purple to Pink)
// ====================
function showCopyNotification() {
    const container = document.getElementById('notificationContainer');
    
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification toast-copy';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-copy"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">✅ You copied the IP! ✅</div>
            <div class="toast-message">Now paste it in your Minecraft Server IP section 🎮</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast-notification').remove()">
            <i class="fas fa-times"></i>
        </button>
        <div class="toast-progress">
            <div class="toast-progress-bar"></div>
        </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

// ====================
// REGULAR NOTIFICATION (Fallback)
// ====================
function showNotification(title, message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-triangle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-circle'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${icons[type] || 'fa-bell'}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast-notification').remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

// ====================
// MODAL FUNCTIONS
// ====================
function initModal() {
    modal = document.getElementById('ipModal');
    copyIpBtn = document.getElementById('copyIpBtn');
    
    if (copyIpBtn) {
        copyIpBtn.addEventListener('click', () => {
            if (modal) modal.classList.add('active');
        });
    }
}

function initCloseModalButtons() {
    const closeModal = document.querySelector('.close-modal');
    
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            if (modal) modal.classList.remove('active');
        });
    }
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });
}

// ====================
// COPY BUTTONS (Modal)
// ====================
function initCopyButtons() {
    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ipToCopy = btn.getAttribute('data-ip');
            if (ipToCopy) {
                await copyToClipboard(ipToCopy);
            }
        });
    });
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
        
        showCopyNotification();
        
        if (navigator.vibrate) {
            navigator.vibrate(100);
        }
        
        if (modal && modal.classList.contains('active')) {
            setTimeout(() => {
                modal.classList.remove('active');
            }, 1500);
        }
        
    } catch (err) {
        showNotification('Copy Failed', 'Please copy manually', 'error');
    }
}

// ====================
// DISCORD BUTTON
// ====================
function initDiscordButton() {
    discordBtn = document.getElementById('discordBtn');
    
    if (discordBtn) {
        discordBtn.addEventListener('click', () => {
            showNotification('Opening Discord...', 'Join our amazing community! 🎉', 'info');
            
            setTimeout(() => {
                window.open(SERVER_CONFIG.discordLink, '_blank');
            }, 500);
        });
    }
}

// ====================
// BACK TO TOP
// ====================
function initBackToTop() {
    backToTopBtn = document.getElementById('backToTop');
    
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
        });
        
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
}

// ====================
// GENTLE EFFECTS
// ====================
function initGentleEffects() {
    const cards = document.querySelectorAll('.feature-card, .member-card');
    
    cards.forEach((card, index) => {
        card.style.setProperty('--i', index);
        
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-8px)';
            card.style.transition = 'transform 0.2s ease-out';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0px)';
        });
    });
}

// ====================
// SMOOTH SCROLL
// ====================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ====================
// ADD PARTICLES (Lightweight)
// ====================
function createParticles() {
    const particlesContainer = document.createElement('div');
    particlesContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
        overflow: hidden;
    `;
    document.body.appendChild(particlesContainer);
    
    function createParticle() {
        const particle = document.createElement('div');
        const size = Math.random() * 3 + 1;
        particle.style.cssText = `
            position: absolute;
            bottom: -10px;
            left: ${Math.random() * 100}%;
            width: ${size}px;
            height: ${size}px;
            background: ${['#00e1ff', '#6c5ce7', '#ff0080'][Math.floor(Math.random() * 3)]};
            border-radius: 50%;
            opacity: ${Math.random() * 0.2};
            animation: floatParticle ${Math.random() * 15 + 10}s linear infinite;
            animation-delay: ${Math.random() * 5}s;
        `;
        particlesContainer.appendChild(particle);
        
        setTimeout(() => {
            if (particle.parentNode) particle.remove();
        }, 25000);
    }
    
    for (let i = 0; i < 25; i++) {
        setTimeout(() => createParticle(), i * 200);
    }
    
    setInterval(createParticle, 1000);
}

// Start particles
createParticles();

// Export for debugging
window.SERVER_CONFIG = SERVER_CONFIG;