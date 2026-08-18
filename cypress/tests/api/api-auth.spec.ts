import { User } from "../../../src/models";

type TestAuthCtx = {
  authenticatedUser?: User;
};
describe("Auth API", function () {
  let ctx: TestAuthCtx = {};

  beforeEach(function () {
    cy.task("db:seed");

    cy.database("filter", "users").then((users: User[]) => {
      ctx.authenticatedUser = users[0];

      return cy.loginByApi(ctx.authenticatedUser.username);
    });
  });

  context("POST /logout", function () {
    it("logs out the current user", function () {
      cy.logoutByApi().then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.message).to.eq("Logged out");
      });
    });

    it("invalidates the authenticated session", function () {
      cy.logoutByApi().then(() => {
        cy.request({
          url: `${Cypress.expose("apiUrl")}/checkAuth`,
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(401);
        });
      });
    });
  });
});
