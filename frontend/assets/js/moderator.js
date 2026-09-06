const API_URL = "http://127.0.0.1:8000/api";

const token = localStorage.getItem("token");
const role = localStorage.getItem("role");
const user = JSON.parse(localStorage.getItem("user") || "{}");

/* ==========================================
   AUTH PROTECTION
========================================== */

if (!token) {
    window.location.href = "login.html";
}

if (role !== "Moderator") {
    window.location.href = "client.html";
}

/* ==========================================
   GLOBAL STATE
========================================== */

let courses = [];

/* ==========================================
   DOM READY
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    initializeUser();
    initializeNavigation();
    initializeLogout();
    initializeModal();

    loadCourses();

});

/* ==========================================
   USER INFO
========================================== */

function initializeUser() {

    const moderatorName =
        document.getElementById("moderatorName");

    if (moderatorName) {
        moderatorName.textContent =
            user.name || "Moderator";
    }

}

/* ==========================================
   NAVIGATION
========================================== */

function initializeNavigation() {

    const navItems =
        document.querySelectorAll(".nav-item");

    const sections =
        document.querySelectorAll(".section");

    navItems.forEach(item => {

        item.addEventListener("click", () => {

            navItems.forEach(nav =>
                nav.classList.remove("active")
            );

            sections.forEach(section =>
                section.classList.remove("active")
            );

            item.classList.add("active");

            const target =
                item.dataset.section;

            document
                .getElementById(target)
                .classList.add("active");

        });

    });

}

/* ==========================================
   LOGOUT
========================================== */

function initializeLogout() {

    document
        .getElementById("logoutBtn")
        ?.addEventListener("click", async () => {

            if (!confirm("Are you sure?")) {
                return;
            }

            try {

                await fetch(
                    `${API_URL}/logout`,
                    {
                        method: "POST",
                        headers: {
                            Accept:
                                "application/json",
                            Authorization:
                                `Bearer ${token}`
                        }
                    }
                );

            } catch (error) {

                console.error(error);

            }

            localStorage.removeItem("token");
            localStorage.removeItem("role");
            localStorage.removeItem("user");

            window.location.href =
                "login.html";

        });

}

/* ==========================================
   MODAL
========================================== */

function initializeModal() {

    const addBtn =
        document.getElementById("addCourseBtn");

    const modal =
        document.getElementById("courseModal");

    addBtn?.addEventListener("click", () => {

        modal.style.display = "flex";

    });

    modal?.addEventListener("click", e => {

        if (e.target === modal) {

            modal.style.display = "none";

        }

    });

    document
        .getElementById("courseForm")
        ?.addEventListener(
            "submit",
            createCourse
        );

}

/* ==========================================
   LOAD COURSES
========================================== */

async function loadCourses() {

    try {

        const response = await fetch(
            `${API_URL}/moderator/courses`,
            {
                headers: {
                    Accept:
                        "application/json",
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );

        const data =
            await response.json();

        courses = data;

        renderCourses();
        updateStats();

    } catch (error) {

        console.error(error);

        alert(
            "Failed to load courses"
        );

    }

}

/* ==========================================
   RENDER COURSES
========================================== */

function renderCourses() {

    const tbody =
        document.getElementById(
            "coursesTableBody"
        );

    if (!tbody) return;

    tbody.innerHTML = "";

    courses.forEach(course => {

        tbody.innerHTML += `
            <tr>

                <td>${course.id}</td>

                <td>${course.title}</td>

                <td>${course.price}</td>

                <td>${course.status}</td>

               <td>

    <button
        onclick="editCourse(${course.id})"
        class="btn btn-primary"
    >
        Edit
    </button>

    <button
        onclick="deleteCourse(${course.id})"
        class="btn btn-danger"
    >
        Delete
    </button>

</td>

            </tr>
        `;

    });

}

/* ==========================================
   DASHBOARD STATS
========================================== */

function updateStats() {

    const totalCourses =
        document.getElementById(
            "totalCourses"
        );

    if (totalCourses) {

        totalCourses.textContent =
            courses.length;

    }

}

/* ==========================================
   CREATE COURSE
========================================== */

async function createCourse(e) {

    e.preventDefault();

    const title =
        document.getElementById(
            "courseTitle"
        ).value;

    const description =
        document.getElementById(
            "courseDescription"
        ).value;

    const price =
        document.getElementById(
            "coursePrice"
        ).value;

    const status =
        document.getElementById(
            "courseStatus"
        ).value;

    try {

        const response = await fetch(
            `${API_URL}/moderator/courses`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    Authorization:
                        `Bearer ${token}`
                },

                body: JSON.stringify({
                    title,
                    description,
                    price,
                    status
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.message ||
                "Failed to create"
            );

        }

        document
            .getElementById(
                "courseForm"
            )
            .reset();

        document
            .getElementById(
                "courseModal"
            )
            .style.display = "none";

        await loadCourses();

        alert(
            "Course created successfully"
        );

    } catch (error) {

        alert(error.message);

    }

}

/* ==========================================
   DELETE COURSE
========================================== */

async function deleteCourse(id) {

    if (
        !confirm(
            "Delete this course?"
        )
    ) {
        return;
    }

    try {

        const response = await fetch(
            `${API_URL}/moderator/courses/${id}`,
            {
                method: "DELETE",

                headers: {
                    Accept:
                        "application/json",

                    Authorization:
                        `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {

            throw new Error(
                "Delete failed"
            );

        }

        await loadCourses();

        alert(
            "Course deleted successfully"
        );

    } catch (error) {

        alert(error.message);

    }

}


/* ==========================================
   EDIT COURSE
========================================== */

async function editCourse(id) {

    const course =
        courses.find(c => c.id === id);

    if (!course) return;

    const title = prompt(
        "Course Title",
        course.title
    );

    if (title === null) return;

    const description = prompt(
        "Course Description",
        course.description || ""
    );

    if (description === null) return;

    const price = prompt(
        "Course Price",
        course.price || 0
    );

    if (price === null) return;

    const status = prompt(
        "Status (draft/published)",
        course.status
    );

    if (status === null) return;

    try {

        const response = await fetch(
            `${API_URL}/moderator/courses/${id}`,
            {
                method: "PUT",

                headers: {
                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    Authorization:
                        `Bearer ${token}`
                },

                body: JSON.stringify({
                    title,
                    description,
                    price,
                    status
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.message ||
                "Update failed"
            );

        }

        await loadCourses();

        alert(
            "Course updated successfully"
        );

    } catch (error) {

        alert(error.message);

    }

}
