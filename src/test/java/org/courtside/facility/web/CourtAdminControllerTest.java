package org.courtside.facility.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class CourtAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenCreatingACourt_thenItAppearsInTheAdminListAndInThePublicList() throws Exception {
        // given
        mockMvc.perform(post("/api/admin/courts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5, "name": "Centre Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.number").value(5))
                .andExpect(jsonPath("$.name").value("Centre Court"))
                .andExpect(jsonPath("$.active").value(true));

        // when / then
        mockMvc.perform(get("/api/admin/courts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        mockMvc.perform(get("/api/public/courts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void whenCreatingACourt_thenTheLocationHeaderResolvesToTheCreatedCourt() throws Exception {
        // given
        MvcResult created = mockMvc.perform(post("/api/admin/courts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5, "name": "Centre Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        String location = created.getResponse().getHeader("Location");
        String id = location.substring(location.lastIndexOf('/') + 1);

        // when / then
        mockMvc.perform(get(location))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.number").value(5))
                .andExpect(jsonPath("$.name").value("Centre Court"));
    }

    @Test
    void givenAnUnknownCourt_whenGettingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/courts/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-not-found"))
                .andExpect(jsonPath("$.title").value("Court not found"));
    }

    @Test
    void whenCreatingACourtWithoutAName_thenItReportsANullNameAndKeepsItsNumber() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/courts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 7}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.number").value(7))
                .andExpect(jsonPath("$.name").doesNotExist());
    }

    @Test
    void givenTwoCourts_whenCreatingAThirdWithATakenNumber_thenItIsAConflict() throws Exception {
        // given
        createCourt(5, "Centre Court");

        // when / then
        mockMvc.perform(post("/api/admin/courts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5, "name": "Indoor Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-number-taken"))
                .andExpect(jsonPath("$.title").value("Court number taken"));

        mockMvc.perform(get("/api/admin/courts"))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void givenADeactivatedCourt_whenListing_thenOnlyTheAdminListStillShowsIt() throws Exception {
        // given
        String id = createCourt(5, "Centre Court");
        mockMvc.perform(put("/api/admin/courts/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        // when / then
        mockMvc.perform(get("/api/admin/courts"))
                .andExpect(jsonPath("$.length()").value(1));

        mockMvc.perform(get("/api/public/courts"))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void givenADeactivatedCourt_whenReactivatingIt_thenItReturnsToThePublicList() throws Exception {
        // given
        String id = createCourt(5, "Centre Court");
        mockMvc.perform(put("/api/admin/courts/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()));

        // when
        mockMvc.perform(put("/api/admin/courts/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": true}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true));

        // then
        mockMvc.perform(get("/api/public/courts"))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void givenARenamedCourt_whenReadingThePublicList_thenTheNewNameIsServed() throws Exception {
        // given
        String id = createCourt(5, "Centre Court");

        // when
        mockMvc.perform(put("/api/admin/courts/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5, "name": "Indoor Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/public/courts"))
                .andExpect(jsonPath("$[0].name").value("Indoor Court"));
    }

    @Test
    void givenANamedCourt_whenChangingItWithoutAName_thenTheCourtIsStillListedWithNoName() throws Exception {
        // given
        String id = createCourt(5, "Centre Court");

        // when
        mockMvc.perform(put("/api/admin/courts/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").doesNotExist());

        // then
        mockMvc.perform(get("/api/public/courts"))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").doesNotExist());
    }

    @Test
    void givenACourt_whenChangingItWithoutANumber_thenItIsRejectedAsInvalid() throws Exception {
        // given
        String id = createCourt(5, "Centre Court");

        // when / then
        mockMvc.perform(put("/api/admin/courts/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Centre Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("number"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    void givenAnUnknownCourt_whenChangingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/courts/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 5, "name": "Centre Court"}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Court not found"));
    }

    @Test
    void givenTwoCourts_whenRenumberingOne_thenThePublicListOrdersByTheNewNumber() throws Exception {
        // given
        createCourt(2, "Court A");
        String higher = createCourt(5, "Court B");

        // when
        mockMvc.perform(put("/api/admin/courts/" + higher)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 1, "name": "Court B"}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value(1));

        // then
        mockMvc.perform(get("/api/public/courts"))
                .andExpect(jsonPath("$[0].name").value("Court B"))
                .andExpect(jsonPath("$[1].name").value("Court A"));
    }

    @Test
    void givenTwoCourts_whenRenumberingOneOntoTheOthersNumber_thenItIsAConflictAndBothAreUnchanged() throws Exception {
        // given
        String first = createCourt(1, "Court 1");
        createCourt(2, "Court 2");

        // when / then
        mockMvc.perform(put("/api/admin/courts/" + first)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": 2, "name": "Court 1"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-number-taken"))
                .andExpect(jsonPath("$.title").value("Court number taken"));

        String adminList = mockMvc.perform(get("/api/admin/courts"))
                .andReturn().getResponse().getContentAsString();
        List<Integer> numbers = JsonPath.read(adminList, "$[*].number");
        assertThat(numbers).containsExactlyInAnyOrder(1, 2);
    }

    @Test
    void givenTwoCourts_whenSwappingTheirNumbersViaAFreeIntermediateNumber_thenBothEndUpSwapped()
            throws Exception {
        // given
        String courtOne = createCourt(1, "Court One");
        String courtTwo = createCourt(2, "Court Two");

        // when
        changeCourt(courtOne, 99, "Court One");
        changeCourt(courtTwo, 1, "Court Two");
        changeCourt(courtOne, 2, "Court One");

        // then
        String adminList = mockMvc.perform(get("/api/admin/courts"))
                .andReturn().getResponse().getContentAsString();
        List<Integer> numbers = JsonPath.read(adminList, "$[*].number");
        assertThat(numbers).containsExactlyInAnyOrder(1, 2);
        List<String> namesAtOne = JsonPath.read(adminList, "$[?(@.number == 1)].name");
        List<String> namesAtTwo = JsonPath.read(adminList, "$[?(@.number == 2)].name");
        assertThat(namesAtOne).containsExactly("Court Two");
        assertThat(namesAtTwo).containsExactly("Court One");
    }

    private void changeCourt(String id, int number, String name) throws Exception {
        mockMvc.perform(put("/api/admin/courts/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": %d, "name": "%s"}
                                """.formatted(number, name))
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private String createCourt(int number, String name) throws Exception {
        String body = mockMvc.perform(post("/api/admin/courts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"number": %d, "name": "%s"}
                                """.formatted(number, name))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
