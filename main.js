import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { OBJLoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/MTLLoader.js';

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;

// Physics world setup
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0)
});

// Add contact material for better ground interaction
const groundPhysicsMaterial = new CANNON.Material('groundMaterial');
const characterMaterial = new CANNON.Material('characterMaterial');
const contactMaterial = new CANNON.ContactMaterial(
    groundPhysicsMaterial,
    characterMaterial,
    {
        friction: 0.5,
        restitution: 0.0
    }
);
world.addContactMaterial(contactMaterial);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Physics ground
const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: groundPhysicsMaterial
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// Character classes
class Gorilla {
    constructor() {
        this.mesh = null;
        this.body = null;
        this.health = 5000;
        this.attackCooldown = 0;
        this.attackRange = 3;
        this.attackDamage = 200;
        this.speed = 2;
        this.target = null;
        this.isAttacking = false;
    }

    async loadModel() {
        const objLoader = new OBJLoader();
        const textureLoader = new THREE.TextureLoader();
        
        // Load all textures
        const [diffuseTexture, normalTexture, roughnessTexture] = await Promise.all([
            textureLoader.loadAsync('Textures/Gorilla_Quad_Diffuse.png'),
            textureLoader.loadAsync('Textures/Gorilla_Quad_Normal.png'),
            textureLoader.loadAsync('Textures/Gorilla_Quad_Roughness.png')
        ]);

        // Configure texture properties
        [diffuseTexture, normalTexture, roughnessTexture].forEach(texture => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
        });

        // Load object
        const object = await objLoader.loadAsync('models/gorilla.obj');
        
        // Apply textures to all materials
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = new THREE.MeshStandardMaterial({
                    map: diffuseTexture,
                    normalMap: normalTexture,
                    roughnessMap: roughnessTexture,
                    roughness: 0.7,
                    metalness: 0.1
                });
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        this.mesh = object;
        
        // Set up physics body with proper constraints
        this.body = new CANNON.Body({
            mass: 100,
            shape: new CANNON.Box(new CANNON.Vec3(1, 2, 1)),
            position: new CANNON.Vec3(0, 1, 0),
            material: characterMaterial,
            linearDamping: 0.5,
            angularDamping: 0.3
        });
        
        // Add constraints to prevent rotation and bouncing
        this.body.fixedRotation = true;
        
        // Add a stronger downward force to keep on ground
        this.body.addEventListener('preStep', () => {
            // Apply gravity and additional downward force
            this.body.applyForce(new CANNON.Vec3(0, -19.62, 0), this.body.position);
            
            // If position is too high, force it back down
            if (this.body.position.y > 1.5) {
                this.body.position.y = 1.5;
                this.body.velocity.y = 0;
                this.body.angularVelocity.set(0, 0, 0);
            }
            
            // Limit horizontal velocity
            const maxSpeed = 5;
            const currentVelocity = this.body.velocity;
            const horizontalVelocity = new CANNON.Vec3(currentVelocity.x, 0, currentVelocity.z);
            if (horizontalVelocity.length() > maxSpeed) {
                horizontalVelocity.normalize();
                horizontalVelocity.scale(maxSpeed, horizontalVelocity);
                this.body.velocity.x = horizontalVelocity.x;
                this.body.velocity.z = horizontalVelocity.z;
            }
        });
        
        this.mesh.position.copy(this.body.position);
        this.mesh.quaternion.copy(this.body.quaternion);
        
        scene.add(this.mesh);
        world.addBody(this.body);
    }

    update(deltaTime, men) {
        if (!this.mesh || !this.body) return;

        // Find closest man
        let closestMan = null;
        let minDistance = Infinity;
        
        men.forEach(man => {
            if (!man.body || man.isDead) return; // Skip dead men
            const distance = this.body.position.distanceTo(man.body.position);
            if (distance < minDistance) {
                minDistance = distance;
                closestMan = man;
            }
        });

        this.target = closestMan;

        // Move towards target
        if (this.target) {
            const direction = new CANNON.Vec3();
            direction.copy(this.target.body.position);
            direction.vsub(this.body.position, direction);
            direction.y = 0; // Keep movement horizontal
            direction.normalize();
            
            // Only move if not too close to target
            if (minDistance > this.attackRange) {
                direction.scale(this.speed * 100, direction); // Increased force
                this.body.applyForce(direction, this.body.position);
            } else {
                // Stop moving when in attack range
                this.body.velocity.set(0, this.body.velocity.y, 0);
            }

            // Attack if in range
            if (minDistance < this.attackRange && this.attackCooldown <= 0) {
                this.attack(this.target);
                this.attackCooldown = 1.0;
                this.isAttacking = true;
                
                // Add a knockback effect
                const knockback = new CANNON.Vec3();
                knockback.copy(direction);
                knockback.scale(-20, knockback); // Increased knockback
                this.target.body.applyImpulse(knockback, this.target.body.position);
            }
        }

        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
            if (this.attackCooldown <= 0) {
                this.isAttacking = false;
            }
        }

        // Update mesh position and rotation
        this.mesh.position.copy(this.body.position);
        
        // Face the target
        if (this.target) {
            const targetPosition = new THREE.Vector3();
            targetPosition.copy(this.target.body.position);
            this.mesh.lookAt(targetPosition);
        }
    }

    attack(target) {
        if (this.attackCooldown <= 0) {
            target.takeDamage(this.attackDamage);
            this.attackCooldown = 0.3;
            this.isAttacking = true;
            console.log(`Gorilla attacked! Target health: ${target.health}`);
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        console.log(`Gorilla took ${amount} damage! Health remaining: ${this.health}`);
        if (this.health <= 0) {
            console.log("Gorilla has been defeated!");
            scene.remove(this.mesh);
            world.removeBody(this.body);
        }
    }
}

class Man {
    constructor() {
        this.mesh = null;
        this.body = null;
        this.health = 30;
        this.speed = 2.5;
        this.attackCooldown = 0;
        this.attackDamage = 5;
        this.attackRange = 1.0;
        this.isAttacking = false;
        this.isDead = false;
    }

    async loadModel() {
        try {
            const objLoader = new OBJLoader();
            const object = await objLoader.loadAsync('models/man.obj');
            this.mesh = object;
            
            // Set up physics body with proper constraints
            this.body = new CANNON.Body({
                mass: 70,
                shape: new CANNON.Box(new CANNON.Vec3(0.5, 1, 0.5)),
                position: new CANNON.Vec3(
                    Math.random() * 20 - 10,
                    1,
                    Math.random() * 20 - 10
                ),
                material: characterMaterial,
                linearDamping: 0.5,
                angularDamping: 0.3
            });
            
            // Add constraints to prevent rotation while alive
            this.body.fixedRotation = true;
            
            // Add a stronger downward force to keep on ground
            this.body.addEventListener('preStep', () => {
                if (!this.isDead) {
                    // Apply gravity and additional downward force
                    this.body.applyForce(new CANNON.Vec3(0, -19.62, 0), this.body.position);
                    
                    // If position is too high, force it back down
                    if (this.body.position.y > 1.5) {
                        this.body.position.y = 1.5;
                        this.body.velocity.y = 0;
                        this.body.angularVelocity.set(0, 0, 0);
                    }
                }
            });
            
            this.mesh.position.copy(this.body.position);
            this.mesh.quaternion.copy(this.body.quaternion);
            
            scene.add(this.mesh);
            world.addBody(this.body);
        } catch (error) {
            console.error('Error loading man model:', error);
            this.isDead = true;
        }
    }

    update(deltaTime, gorilla) {
        if (!this.mesh || !this.body || !gorilla.body || this.isDead) return;

        const direction = new CANNON.Vec3();
        direction.copy(gorilla.body.position);
        direction.vsub(this.body.position, direction);
        const distance = direction.length();
        direction.y = 0; // Keep movement horizontal
        direction.normalize();

        // Move towards gorilla
        if (distance > this.attackRange) {
            const force = new CANNON.Vec3();
            force.copy(direction);
            force.scale(this.speed * 200, force);
            this.body.applyForce(force, this.body.position);
            
            // Apply additional force to maintain speed
            const currentSpeed = this.body.velocity.length();
            if (currentSpeed < this.speed) {
                const boostForce = new CANNON.Vec3();
                boostForce.copy(direction);
                boostForce.scale(this.speed * 100, boostForce);
                this.body.applyForce(boostForce, this.body.position);
            }
        } else {
            // Stop moving when in attack range
            this.body.velocity.set(0, this.body.velocity.y, 0);
            
            // Attack if in range
            if (this.attackCooldown <= 0) {
                this.attack(gorilla);
                this.attackCooldown = 0.2;
                this.isAttacking = true;
            }
        }

        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
            if (this.attackCooldown <= 0) {
                this.isAttacking = false;
            }
        }

        // Update mesh position and rotation
        this.mesh.position.copy(this.body.position);
        
        // Face the gorilla
        const gorillaPosition = new THREE.Vector3();
        gorillaPosition.copy(gorilla.body.position);
        this.mesh.lookAt(gorillaPosition);
    }

    attack(target) {
        if (this.attackCooldown <= 0) {
            target.takeDamage(this.attackDamage);
            this.attackCooldown = 0.2;
            this.isAttacking = true;
            console.log(`Man attacked gorilla! Damage: ${this.attackDamage}`);
        }
    }

    takeDamage(amount) {
        if (this.isDead) return;
        
        this.health -= amount;
        console.log(`Man took ${amount} damage! Health remaining: ${this.health}`);
        if (this.health <= 0) {
            console.log("Man has been defeated!");
            this.die();
        }
    }

    die() {
        this.isDead = true;
        console.log("Man died!");
        
        // Enable rotation for ragdoll effect
        this.body.fixedRotation = false;
        
        // Apply random rotation and force for ragdoll effect
        const randomRotation = new CANNON.Vec3(
            Math.random() * 2 - 1,
            Math.random() * 2 - 1,
            Math.random() * 2 - 1
        );
        this.body.angularVelocity.copy(randomRotation);
        
        // Apply upward and backward force for ragdoll effect
        const ragdollForce = new CANNON.Vec3(
            Math.random() * 2 - 1,
            4,
            Math.random() * 2 - 1
        );
        this.body.applyImpulse(ragdollForce, this.body.position);
        
        // Remove from scene after a longer delay
        setTimeout(() => {
            if (this.mesh) scene.remove(this.mesh);
            if (this.body) world.removeBody(this.body);
            this.mesh = null;
            this.body = null;
        }, 10000);
    }
}

// Game state
const gorilla = new Gorilla();
const men = Array(100).fill().map(() => new Man());

// Load models
async function loadModels() {
    try {
        await gorilla.loadModel();
        const loadPromises = men.map(man => man.loadModel());
        await Promise.all(loadPromises);
        
        // Filter out dead men after loading
        const aliveMen = men.filter(man => !man.isDead);
        console.log(`Successfully loaded ${aliveMen.length} men`);
    } catch (error) {
        console.error('Error loading models:', error);
    }
}

// Camera position
camera.position.set(0, 10, 20);
camera.lookAt(0, 0, 0);

// Camera controls
const cameraSpeed = 10;
const zoomSpeed = 1;
const rotationSpeed = 0.01;
const keys = {
    w: false,
    a: false,
    s: false,
    d: false
};

// Handle keyboard input
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() in keys) {
        keys[e.key.toLowerCase()] = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() in keys) {
        keys[e.key.toLowerCase()] = false;
    }
});

// Mouse controls
let isMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };

// Mouse wheel zoom
document.addEventListener('wheel', (e) => {
    const zoomAmount = e.deltaY * zoomSpeed * 0.01;
    camera.position.addScaledVector(camera.getWorldDirection(new THREE.Vector3()), zoomAmount);
});

// Mouse rotation
document.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

document.addEventListener('mouseup', () => {
    isMouseDown = false;
});

document.addEventListener('mousemove', (e) => {
    if (isMouseDown) {
        const deltaMove = {
            x: e.clientX - previousMousePosition.x,
            y: e.clientY - previousMousePosition.y
        };

        // Rotate camera around Y axis (left/right)
        camera.position.applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -deltaMove.x * rotationSpeed
        );

        // Rotate camera around X axis (up/down)
        const currentRotation = camera.rotation.x;
        const newRotation = currentRotation - deltaMove.y * rotationSpeed;
        if (newRotation > -Math.PI/2 && newRotation < Math.PI/2) {
            camera.rotation.x = newRotation;
        }

        // Update camera to look at center
        camera.lookAt(0, 0, 0);

        previousMousePosition = { x: e.clientX, y: e.clientY };
    }
});

// Add UI element for win message
const winMessage = document.createElement('div');
winMessage.style.position = 'absolute';
winMessage.style.top = '50%';
winMessage.style.left = '50%';
winMessage.style.transform = 'translate(-50%, -50%)';
winMessage.style.color = 'white';
winMessage.style.fontSize = '48px';
winMessage.style.fontWeight = 'bold';
winMessage.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
winMessage.style.display = 'none';
winMessage.style.zIndex = '1000';
document.body.appendChild(winMessage);

// Add win condition check
function checkWinCondition() {
    const aliveMen = men.filter(man => !man.isDead);
    const deadMen = men.length - aliveMen.length;
    console.log(`Alive men: ${aliveMen.length}, Dead men: ${deadMen}, Gorilla health: ${Math.floor(gorilla.health)}`);
    
    if (gorilla.health <= 0) {
        const message = `Men Win! ${aliveMen.length} men survived!`;
        console.log(message);
        winMessage.textContent = message;
        winMessage.style.display = 'block';
        return true;
    } else if (deadMen >= 10) {
        const message = `Gorilla Wins! Men defeated! Health remaining: ${Math.floor(gorilla.health)}`;
        console.log(message);
        winMessage.textContent = message;
        winMessage.style.display = 'block';
        return true;
    }
    return false;
}

let animationId = null;
let lastTime = 0;
function animate(currentTime) {
    animationId = requestAnimationFrame(animate);
    
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // Update physics
    world.step(1/60);
    
    // Update camera position based on WASD keys
    const direction = new THREE.Vector3();
    
    if (keys.w) direction.z -= 1;
    if (keys.s) direction.z += 1;
    if (keys.a) direction.x -= 1;
    if (keys.d) direction.x += 1;
    
    if (direction.length() > 0) {
        direction.normalize();
        direction.applyEuler(new THREE.Euler(0, camera.rotation.y, 0));
        camera.position.addScaledVector(direction, cameraSpeed * deltaTime);
    }
    
    // Update characters
    gorilla.update(deltaTime, men);
    men.forEach(man => man.update(deltaTime, gorilla));
    
    // Check win condition
    if (checkWinCondition()) {
        // Stop the animation loop
        cancelAnimationFrame(animationId);
        return;
    }
    
    // Render scene
    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start game
loadModels().then(() => {
    animate(0);
}); 