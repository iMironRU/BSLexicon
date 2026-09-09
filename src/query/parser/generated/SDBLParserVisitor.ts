// @ts-nocheck — сгенерировано antlr4ng, не редактируется руками
// Generated from src/query/parser/grammar/SDBLParser.g4 by ANTLR 4.13.1

import { AbstractParseTreeVisitor } from "antlr4ng";


import { QueryPackageContext } from "./SDBLParser.js";
import { QueriesContext } from "./SDBLParser.js";
import { DropTableQueryContext } from "./SDBLParser.js";
import { SelectQueryContext } from "./SDBLParser.js";
import { SubqueryContext } from "./SDBLParser.js";
import { UnionContext } from "./SDBLParser.js";
import { QueryContext } from "./SDBLParser.js";
import { LimitationsContext } from "./SDBLParser.js";
import { TopContext } from "./SDBLParser.js";
import { SelectedFieldsContext } from "./SDBLParser.js";
import { SelectedFieldContext } from "./SDBLParser.js";
import { AsteriskFieldContext } from "./SDBLParser.js";
import { ExpressionFieldContext } from "./SDBLParser.js";
import { ColumnFieldContext } from "./SDBLParser.js";
import { EmptyTableFieldContext } from "./SDBLParser.js";
import { EmptyTableColumnsContext } from "./SDBLParser.js";
import { InlineTableFieldContext } from "./SDBLParser.js";
import { RecordAutoNumberFunctionContext } from "./SDBLParser.js";
import { IndexingItemContext } from "./SDBLParser.js";
import { IndexingSetContext } from "./SDBLParser.js";
import { OrderByContext } from "./SDBLParser.js";
import { OrdersByExpressionContext } from "./SDBLParser.js";
import { TotalByContext } from "./SDBLParser.js";
import { TotalsGroupContext } from "./SDBLParser.js";
import { PeriodicContext } from "./SDBLParser.js";
import { ColumnContext } from "./SDBLParser.js";
import { ExpressionContext } from "./SDBLParser.js";
import { PrimitiveExpressionContext } from "./SDBLParser.js";
import { CaseExpressionContext } from "./SDBLParser.js";
import { CaseBranchContext } from "./SDBLParser.js";
import { BracketExpressionContext } from "./SDBLParser.js";
import { UnaryExpressionContext } from "./SDBLParser.js";
import { FunctionCallContext } from "./SDBLParser.js";
import { BuiltInFunctionsContext } from "./SDBLParser.js";
import { AggregateFunctionsContext } from "./SDBLParser.js";
import { ValueFunctionContext } from "./SDBLParser.js";
import { CastFunctionContext } from "./SDBLParser.js";
import { LogicalExpressionContext } from "./SDBLParser.js";
import { PredicateContext } from "./SDBLParser.js";
import { LikePredicateContext } from "./SDBLParser.js";
import { IsNullPredicateContext } from "./SDBLParser.js";
import { ComparePredicateContext } from "./SDBLParser.js";
import { BetweenPredicateContext } from "./SDBLParser.js";
import { InPredicateContext } from "./SDBLParser.js";
import { RefsPredicateContext } from "./SDBLParser.js";
import { ExpressionListContext } from "./SDBLParser.js";
import { ExpressionListItemContext } from "./SDBLParser.js";
import { DataSourcesContext } from "./SDBLParser.js";
import { DataSourceContext } from "./SDBLParser.js";
import { TableContext } from "./SDBLParser.js";
import { VirtualTableContext } from "./SDBLParser.js";
import { VirtualTableParameterContext } from "./SDBLParser.js";
import { ParameterTableContext } from "./SDBLParser.js";
import { ExternalDataSourceTableContext } from "./SDBLParser.js";
import { JoinPartContext } from "./SDBLParser.js";
import { RightJoinContext } from "./SDBLParser.js";
import { LeftJoinContext } from "./SDBLParser.js";
import { FullJoinContext } from "./SDBLParser.js";
import { InnerJoinContext } from "./SDBLParser.js";
import { AliasContext } from "./SDBLParser.js";
import { DatePartContext } from "./SDBLParser.js";
import { MultiStringContext } from "./SDBLParser.js";
import { SignContext } from "./SDBLParser.js";
import { IdentifierContext } from "./SDBLParser.js";
import { TemporaryTableIdentifierContext } from "./SDBLParser.js";
import { ParameterContext } from "./SDBLParser.js";
import { MdoContext } from "./SDBLParser.js";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `SDBLParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export class SDBLParserVisitor<Result> extends AbstractParseTreeVisitor<Result> {
    /**
     * Visit a parse tree produced by `SDBLParser.queryPackage`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitQueryPackage?: (ctx: QueryPackageContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.queries`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitQueries?: (ctx: QueriesContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.dropTableQuery`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDropTableQuery?: (ctx: DropTableQueryContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.selectQuery`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSelectQuery?: (ctx: SelectQueryContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.subquery`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSubquery?: (ctx: SubqueryContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.union`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitUnion?: (ctx: UnionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.query`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitQuery?: (ctx: QueryContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.limitations`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLimitations?: (ctx: LimitationsContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.top`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTop?: (ctx: TopContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.selectedFields`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSelectedFields?: (ctx: SelectedFieldsContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.selectedField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSelectedField?: (ctx: SelectedFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.asteriskField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAsteriskField?: (ctx: AsteriskFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.expressionField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpressionField?: (ctx: ExpressionFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.columnField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitColumnField?: (ctx: ColumnFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.emptyTableField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitEmptyTableField?: (ctx: EmptyTableFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.emptyTableColumns`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitEmptyTableColumns?: (ctx: EmptyTableColumnsContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.inlineTableField`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitInlineTableField?: (ctx: InlineTableFieldContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.recordAutoNumberFunction`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRecordAutoNumberFunction?: (ctx: RecordAutoNumberFunctionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.indexingItem`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIndexingItem?: (ctx: IndexingItemContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.indexingSet`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIndexingSet?: (ctx: IndexingSetContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.orderBy`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitOrderBy?: (ctx: OrderByContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.ordersByExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitOrdersByExpression?: (ctx: OrdersByExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.totalBy`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTotalBy?: (ctx: TotalByContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.totalsGroup`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTotalsGroup?: (ctx: TotalsGroupContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.periodic`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPeriodic?: (ctx: PeriodicContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.column`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitColumn?: (ctx: ColumnContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.expression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpression?: (ctx: ExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.primitiveExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPrimitiveExpression?: (ctx: PrimitiveExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.caseExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCaseExpression?: (ctx: CaseExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.caseBranch`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCaseBranch?: (ctx: CaseBranchContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.bracketExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBracketExpression?: (ctx: BracketExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.unaryExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitUnaryExpression?: (ctx: UnaryExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.functionCall`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitFunctionCall?: (ctx: FunctionCallContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.builtInFunctions`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBuiltInFunctions?: (ctx: BuiltInFunctionsContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.aggregateFunctions`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAggregateFunctions?: (ctx: AggregateFunctionsContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.valueFunction`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitValueFunction?: (ctx: ValueFunctionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.castFunction`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCastFunction?: (ctx: CastFunctionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.logicalExpression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLogicalExpression?: (ctx: LogicalExpressionContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.predicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPredicate?: (ctx: PredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.likePredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLikePredicate?: (ctx: LikePredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.isNullPredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIsNullPredicate?: (ctx: IsNullPredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.comparePredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitComparePredicate?: (ctx: ComparePredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.betweenPredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBetweenPredicate?: (ctx: BetweenPredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.inPredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitInPredicate?: (ctx: InPredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.refsPredicate`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRefsPredicate?: (ctx: RefsPredicateContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.expressionList`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpressionList?: (ctx: ExpressionListContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.expressionListItem`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpressionListItem?: (ctx: ExpressionListItemContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.dataSources`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDataSources?: (ctx: DataSourcesContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.dataSource`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDataSource?: (ctx: DataSourceContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.table`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTable?: (ctx: TableContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.virtualTable`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitVirtualTable?: (ctx: VirtualTableContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.virtualTableParameter`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitVirtualTableParameter?: (ctx: VirtualTableParameterContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.parameterTable`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitParameterTable?: (ctx: ParameterTableContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.externalDataSourceTable`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExternalDataSourceTable?: (ctx: ExternalDataSourceTableContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.joinPart`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitJoinPart?: (ctx: JoinPartContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.rightJoin`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRightJoin?: (ctx: RightJoinContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.leftJoin`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLeftJoin?: (ctx: LeftJoinContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.fullJoin`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitFullJoin?: (ctx: FullJoinContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.innerJoin`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitInnerJoin?: (ctx: InnerJoinContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.alias`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAlias?: (ctx: AliasContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.datePart`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDatePart?: (ctx: DatePartContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.multiString`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitMultiString?: (ctx: MultiStringContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.sign`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSign?: (ctx: SignContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.identifier`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIdentifier?: (ctx: IdentifierContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.temporaryTableIdentifier`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTemporaryTableIdentifier?: (ctx: TemporaryTableIdentifierContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.parameter`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitParameter?: (ctx: ParameterContext) => Result;
    /**
     * Visit a parse tree produced by `SDBLParser.mdo`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitMdo?: (ctx: MdoContext) => Result;
}

