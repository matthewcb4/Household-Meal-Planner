// public/landing.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Menu Toggle ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mainHeader = document.querySelector('.main-header');

    mobileMenuBtn.addEventListener('click', () => {
        mainHeader.classList.toggle('open');
    });

    // --- Smooth Scrolling for Nav Links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
             // Close mobile menu after clicking a link
            if (mainHeader.classList.contains('open')) {
                mainHeader.classList.remove('open');
            }
        });
    });

    // --- Particle Background Animation using Three.js ---
    const particleContainer = document.getElementById('particle-background');
    if (particleContainer && typeof THREE !== 'undefined') {
        let scene, camera, renderer, particles, material;
        let windowHalfX = window.innerWidth / 2;
        let windowHalfY = window.innerHeight / 2;
        let mouseX = 0;
        let mouseY = 0;

        function initParticles() {
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 10000);
            camera.position.z = 1000;

            const particleCount = 1000;
            const particlesGeometry = new THREE.BufferGeometry();
            const positions = new Float32Array(particleCount * 3);

            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                positions[i3] = Math.random() * 2000 - 1000;
                positions[i3 + 1] = Math.random() * 2000 - 1000;
                positions[i3 + 2] = Math.random() * 2000 - 1000;
            }
            particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            material = new THREE.PointsMaterial({
                color: 0x1DB954, // --primary-accent-color
                size: 2,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending
            });

            particles = new THREE.Points(particlesGeometry, material);
            scene.add(particles);

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            particleContainer.appendChild(renderer.domElement);

            document.addEventListener('mousemove', onDocumentMouseMove, false);
            window.addEventListener('resize', onWindowResize, false);
        }

        function onWindowResize() {
            windowHalfX = window.innerWidth / 2;
            windowHalfY = window.innerHeight / 2;
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        function onDocumentMouseMove(event) {
            mouseX = (event.clientX - windowHalfX) / 2;
            mouseY = (event.clientY - windowHalfY) / 2;
        }

        function animateParticles() {
            requestAnimationFrame(animateParticles);
            renderParticles();
        }

        function renderParticles() {
            const time = Date.now() * 0.00005;
            camera.position.x += (mouseX - camera.position.x) * 0.05;
            camera.position.y += (-mouseY - camera.position.y) * 0.05;
            camera.lookAt(scene.position);

            particles.rotation.x = time * 0.2;
            particles.rotation.y = time * 0.4;
            
            renderer.render(scene, camera);
        }

        initParticles();
        animateParticles();
    }
});
